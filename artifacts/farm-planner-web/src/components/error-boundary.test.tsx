import { fireEvent, render, screen } from '@testing-library/react';
import { Component, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from './error-boundary';
import { goToStartPage, refreshApp } from '@/lib/route-load-recovery';

vi.mock('@/lib/route-load-recovery', () => ({
  goToStartPage: vi.fn(),
  refreshApp: vi.fn().mockResolvedValue(undefined),
}));

let shouldThrow = true;

class RecoverableCrash extends Component {
  render(): ReactNode {
    if (shouldThrow) throw new Error('route failed');
    return <p>Recovered page</p>;
  }
}

describe('ErrorBoundary recovery actions', () => {
  beforeEach(() => {
    shouldThrow = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('offers retry, start-page navigation, and a full app refresh', () => {
    render(
      <ErrorBoundary>
        <RecoverableCrash />
      </ErrorBoundary>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Go to start page' }));
    expect(goToStartPage).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh app' }));
    expect(refreshApp).toHaveBeenCalledOnce();
    expect(
      (screen.getByRole('button', { name: 'Refreshing…' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('Recovered page')).toBeTruthy();
  });
});