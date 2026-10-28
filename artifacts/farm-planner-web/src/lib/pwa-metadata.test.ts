import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(import.meta.dirname, '../../public');
const manifest = JSON.parse(
  readFileSync(resolve(publicDir, 'manifest.webmanifest'), 'utf8'),
) as {
  display: string;
  name: string;
  short_name: string;
  icons: Array<{
    purpose: string;
    sizes: string;
    src: string;
    type: string;
  }>;
};
const indexHtml = readFileSync(resolve(publicDir, '../index.html'), 'utf8');
const serviceWorker = readFileSync(resolve(publicDir, 'sw.js'), 'utf8');

describe('Farm Planner PWA branding', () => {
  it('keeps standard and maskable Android icon metadata', () => {
    expect(manifest.name).toBe('Farm & Orchard Planner');
    expect(manifest.short_name).toBe('Farm Planner');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          src: 'icon-192.png',
          sizes: '192x192',
          type: 'image/png',
          purpose: 'any',
        }),
        expect.objectContaining({
          src: 'icon-512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any',
        }),
        expect.objectContaining({
          src: 'icon-maskable-192.png',
          sizes: '192x192',
          type: 'image/png',
          purpose: 'maskable',
        }),
        expect.objectContaining({
          src: 'icon-maskable-512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        }),
      ]),
    );
  });

  it('keeps document icons and offline shell assets on the same brand', () => {
    expect(indexHtml).toContain('rel="icon" type="image/svg+xml" href="favicon.svg"');
    expect(indexHtml).toContain(
      'rel="icon" type="image/png" sizes="32x32" href="icon-32.png"',
    );
    expect(indexHtml).toContain(
      'rel="apple-touch-icon" sizes="180x180" href="apple-touch-icon.png"',
    );

    for (const asset of [
      'favicon.svg',
      'favicon-maskable.svg',
      'icon-32.png',
      'apple-touch-icon.png',
      'icon-192.png',
      'icon-512.png',
      'icon-maskable-192.png',
      'icon-maskable-512.png',
    ]) {
      expect(serviceWorker).toContain(`"./${asset}"`);
    }
  });
});