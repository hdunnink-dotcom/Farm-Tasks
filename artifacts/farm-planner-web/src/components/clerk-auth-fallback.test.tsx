// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ClerkAuthFallback } from './clerk-auth-fallback';

describe('ClerkAuthFallback', () => {
  it('explains how to recover from a stale invitation and retries', () => {
    const resetError = vi.fn();

    render(<ClerkAuthFallback error={new Error('invalid ticket')} resetError={resetError} />);

    expect(screen.getByRole('alert').textContent).toContain('ask the farm owner to resend your invitation');
    fireEvent.click(screen.getByTestId('button-retry-clerk-auth'));
    expect(resetError).toHaveBeenCalledOnce();
    expect(screen.getByTestId('link-sign-in-from-clerk-error').getAttribute('href')).toBe('/sign-in');
  });
});