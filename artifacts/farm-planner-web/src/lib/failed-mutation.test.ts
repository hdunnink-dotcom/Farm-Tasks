import { describe, expect, it } from 'vitest';
import { failedMutationReason } from './failed-mutation';

describe('failedMutationReason', () => {
  it('shows the server reason for a refused change', () => {
    expect(failedMutationReason({ lastError: 'Needs attention', serverMessage: 'Imported calendar tasks cannot use linked scheduled dates.' }))
      .toBe('Imported calendar tasks cannot use linked scheduled dates.');
  });
  it('falls back to the stored status', () => {
    expect(failedMutationReason({ lastError: 'Needs attention' })).toBe('Needs attention');
    expect(failedMutationReason({ lastError: 'Authentication required', serverMessage: 'old' })).toBe('Authentication required');
    expect(failedMutationReason({})).toBe('Needs attention');
  });
});
