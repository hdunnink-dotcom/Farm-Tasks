import { describe, expect, it } from 'vitest';
import { shouldRetryMeRequest } from './use-me';

describe('useMe authentication recovery', () => {
  it('retries transient unauthorized responses while Clerk renews an idle session', () => {
    expect(shouldRetryMeRequest(0, { status: 401 })).toBe(true);
    expect(shouldRetryMeRequest(1, { status: 401 })).toBe(true);
    expect(shouldRetryMeRequest(2, { status: 401 })).toBe(false);
  });

  it('does not retry a real access denial', () => {
    expect(shouldRetryMeRequest(0, { status: 403 })).toBe(false);
  });

  it('keeps the existing retry behavior for temporary server failures', () => {
    expect(shouldRetryMeRequest(0, { status: 503 })).toBe(true);
    expect(shouldRetryMeRequest(1, { status: 503 })).toBe(true);
    expect(shouldRetryMeRequest(2, { status: 503 })).toBe(false);
  });
});