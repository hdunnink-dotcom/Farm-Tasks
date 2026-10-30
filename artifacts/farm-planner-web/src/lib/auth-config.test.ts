import { describe, expect, it } from 'vitest';
import { normalizePublishableKey } from './auth-config';

describe('normalizePublishableKey', () => {
  it('keeps a correct key as it is', () => {
    expect(normalizePublishableKey('pk_test_abc')).toBe('pk_test_abc');
    expect(normalizePublishableKey('pk_live_abc')).toBe('pk_live_abc');
  });

  it('restores a missing leading p and trims spaces', () => {
    expect(normalizePublishableKey('k_test_abc')).toBe('pk_test_abc');
    expect(normalizePublishableKey(' k_live_abc\n')).toBe('pk_live_abc');
  });

  it('treats an empty key as missing', () => {
    expect(normalizePublishableKey('')).toBeUndefined();
    expect(normalizePublishableKey(undefined)).toBeUndefined();
  });
});
