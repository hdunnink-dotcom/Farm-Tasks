import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const serviceWorkerSource = readFileSync(
  resolve(import.meta.dirname, '../../public/sw.js'),
  'utf8',
);

function createServiceWorker() {
  const listeners = new Map<string, (event: unknown) => void>();
  const scope = {
    location: { origin: 'https://farm.test' },
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners.set(type, listener);
    },
  };
  const assetFailure = Symbol('asset-failure');
  const cachesApi = {
    match: vi.fn().mockResolvedValue(undefined),
    open: vi.fn(),
  };
  const fetchApi = vi.fn().mockRejectedValue(new Error('offline'));
  const responseApi = { error: () => assetFailure };

  new Function('self', 'caches', 'fetch', 'Response', serviceWorkerSource)(
    scope,
    cachesApi,
    fetchApi,
    responseApi,
  );

  return {
    fetch: listeners.get('fetch')!,
    assetFailure,
    caches: cachesApi,
    fetchApi,
  };
}

function request(mode: RequestMode, accept = '*/*') {
  return {
    method: 'GET',
    mode,
    url: 'https://farm.test/assets/week.js',
    headers: { get: (name: string) => name === 'accept' ? accept : null },
  };
}

describe('service worker app-shell fallback', () => {
  it('returns an asset failure instead of index.html for failed scripts', async () => {
    const worker = createServiceWorker();
    let response: unknown;
    worker.fetch({
      request: request('cors', 'text/html, */*'),
      respondWith: (value: Promise<unknown>) => { response = value; },
    });

    await expect(response).resolves.toBe(worker.assetFailure);
    expect(worker.caches.match).toHaveBeenCalledWith(expect.anything());
  });

  it('uses the app shell only for document navigations', async () => {
    const worker = createServiceWorker();
    const shell = { body: '<html></html>' };
    worker.caches.match
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(shell);
    let response: unknown;
    worker.fetch({
      request: request('navigate'),
      respondWith: (value: Promise<unknown>) => { response = value; },
    });

    await expect(response).resolves.toBe(shell);
    expect(worker.caches.match).toHaveBeenLastCalledWith('./index.html');
  });
});