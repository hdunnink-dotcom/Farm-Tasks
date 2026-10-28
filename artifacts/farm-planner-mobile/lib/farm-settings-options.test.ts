import { describe, expect, it } from 'vitest';
import { resolveDefaultLocation } from './farm-settings-options';

describe('resolveDefaultLocation', () => {
  it('preserves an explicit no-default selection', () => {
    expect(resolveDefaultLocation(['North block', 'South block'], '')).toBe('');
  });

  it('falls back when a selected location was removed', () => {
    expect(resolveDefaultLocation(['North block'], 'South block')).toBe('North block');
  });
});