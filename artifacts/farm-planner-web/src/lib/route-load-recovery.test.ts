import { describe, expect, it, vi } from 'vitest';

import {
  attemptRouteModuleReload,
  clearRouteModuleReloadGuard,
  goToStartPage,
  isRouteModuleLoadError,
  refreshApp,
  startPageUrl,
} from './route-load-recovery';

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    has: (key: string) => values.has(key),
  };
}

describe('route module load recovery', () => {
  it.each([
    'Failed to fetch dynamically imported module: /assets/week.js',
    'Importing a module script failed.',
    'Error loading dynamically imported module',
    "Unexpected token '<'",
  ])('recognizes %s as a route module failure', (message) => {
    expect(isRouteModuleLoadError(new TypeError(message))).toBe(true);
  });

  it('does not classify ordinary route errors as module failures', () => {
    expect(isRouteModuleLoadError(new Error('Could not load farm access'))).toBe(false);
  });

  it('reloads once, then preserves the original error path', () => {
    const saved = storage();
    const reload = vi.fn();

    expect(attemptRouteModuleReload({ storage: saved, reload })).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
    expect(attemptRouteModuleReload({ storage: saved, reload })).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
    expect(saved.has('farm-planner:route-reload')).toBe(false);
  });

  it('clears the guard after a successful route load', () => {
    const saved = storage();
    const reload = vi.fn();

    attemptRouteModuleReload({ storage: saved, reload });
    clearRouteModuleReloadGuard(saved);

    expect(attemptRouteModuleReload({ storage: saved, reload })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('preserves the import error when storage is unavailable', () => {
    const reload = vi.fn();
    const unavailable = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    };

    expect(attemptRouteModuleReload({ storage: unavailable, reload })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('user-requested app recovery', () => {
  it('builds and navigates to the Vite base as a full document URL', () => {
    const assign = vi.fn();

    expect(startPageUrl('/farm/', 'https://example.test')).toBe(
      'https://example.test/farm/',
    );
    goToStartPage({ baseUrl: '/farm/', origin: 'https://example.test', assign });

    expect(assign).toHaveBeenCalledWith('https://example.test/farm/');
  });

  it('updates the worker, requests a current document, and reloads', async () => {
    const postMessage = vi.fn();
    const update = vi.fn().mockResolvedValue(undefined);
    const getRegistration = vi.fn().mockResolvedValue({
      update,
      waiting: { postMessage },
    });
    const fetchDocument = vi.fn().mockResolvedValue(undefined);
    const reload = vi.fn();

    await refreshApp({
      baseUrl: '/farm/',
      currentUrl: 'https://example.test/farm/tasks',
      serviceWorker: { getRegistration },
      fetchDocument,
      reload,
    });

    expect(getRegistration).toHaveBeenCalledWith('/farm/');
    expect(update).toHaveBeenCalledOnce();
    expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(fetchDocument).toHaveBeenCalledWith(
      'https://example.test/farm/tasks',
    );
    expect(reload).toHaveBeenCalledOnce();
  });

  it('still reloads when worker and network refreshes fail', async () => {
    const reload = vi.fn();

    await refreshApp({
      serviceWorker: {
        getRegistration: vi.fn().mockRejectedValue(new Error('offline')),
      },
      fetchDocument: vi.fn().mockRejectedValue(new Error('offline')),
      reload,
    });

    expect(reload).toHaveBeenCalledOnce();
  });
});