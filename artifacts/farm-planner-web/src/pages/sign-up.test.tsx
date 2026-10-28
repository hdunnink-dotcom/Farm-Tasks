// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const signUpSpy = vi.fn((props: Record<string, unknown>) => (
  <form aria-label="Clerk sign up" data-testid="clerk-sign-up">
    <output data-testid="clerk-sign-up-props">{JSON.stringify(props)}</output>
  </form>
));

vi.mock('@clerk/react', () => ({
  ClerkLoaded: ({ children }: { children: React.ReactNode }) => children,
  ClerkLoading: () => null,
  SignUp: (props: Record<string, unknown>) => signUpSpy(props),
}));

vi.mock('@/components/auth-page-shell', () => ({
  AuthPageShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

vi.mock('@/components/error-boundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/components/invitation-ticket-guard', () => ({
  InvitationTicketGuard: ({ children }: { children: React.ReactNode }) => (
    <section data-testid="invitation-ticket-guard">{children}</section>
  ),
}));

import SignUpPage, { getSafeRedirectUrl } from './sign-up';

describe('SignUpPage', () => {
  beforeEach(() => {
    signUpSpy.mockClear();
    window.history.replaceState({}, '', '/sign-up');
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
  });

  it('delegates password collection and validation to Clerk without local values or transforms', () => {
    render(<SignUpPage />);

    expect(screen.getByTestId('invitation-ticket-guard')).toBeTruthy();
    expect(signUpSpy).toHaveBeenCalledWith(expect.objectContaining({
      routing: 'path',
      path: '/sign-up',
      signInUrl: '/sign-in',
      fallbackRedirectUrl: '/',
    }));
    const props = signUpSpy.mock.calls[0]?.[0] ?? {};
    expect(props).not.toHaveProperty('password');
    expect(props).not.toHaveProperty('initialValues');
  });

  it('keeps invitation tickets available to Clerk while preserving a safe redirect', () => {
    window.history.replaceState(
      {},
      '',
      '/sign-up?__clerk_ticket=redacted&redirect_url=%2Fweek%3Fview%3Dcrew',
    );

    render(<SignUpPage />);

    expect(window.location.search).toContain('__clerk_ticket=redacted');
    expect(signUpSpy).toHaveBeenCalledWith(expect.objectContaining({
      signInUrl: '/sign-in?redirect_url=%2Fweek%3Fview%3Dcrew',
      fallbackRedirectUrl: '/week?view=crew',
    }));
  });

  it('rejects cross-origin redirect targets', () => {
    window.history.replaceState(
      {},
      '',
      '/sign-up?redirect_url=https%3A%2F%2Fevil.example%2Fsteal',
    );

    expect(getSafeRedirectUrl()).toBe('/');
  });
});