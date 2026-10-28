// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InvitationTicketGuard } from './invitation-ticket-guard';

describe('InvitationTicketGuard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.history.replaceState({}, '', '/sign-up?__clerk_ticket=redacted');
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.history.replaceState({}, '', '/');
  });

  it('shows recovery guidance when Clerk accepts no visible ticket state', () => {
    render(<InvitationTicketGuard waitMs={10}><span /></InvitationTicketGuard>);

    act(() => vi.advanceTimersByTime(11));

    expect(screen.getByTestId('invitation-ticket-recovery').textContent).toContain('newest email');
  });

  it('keeps a rendered Clerk form visible', () => {
    render(
      <InvitationTicketGuard waitMs={10}>
        <form aria-label="Create account"><button type="button">Continue</button></form>
      </InvitationTicketGuard>,
    );

    act(() => vi.advanceTimersByTime(11));

    expect(screen.queryByTestId('invitation-ticket-recovery')).toBeNull();
    expect(screen.getByRole('form', { name: 'Create account' })).toBeTruthy();
  });
});