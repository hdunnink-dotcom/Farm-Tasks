import {
  Component,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
  useState,
} from 'react';
import { goToStartPage, refreshApp } from '@/lib/route-load-recovery';

export interface ErrorFallbackProps {
  error: Error;
  resetError: () => void;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  FallbackComponent?: ComponentType<ErrorFallbackProps>;
  /** Changing this clears a caught error. Pass the route to recover on navigation. */
  resetKey?: unknown;
  /** Auth providers can include sensitive request details in thrown errors. */
  logErrors?: boolean;
}

interface ErrorBoundaryState {
  error: Error | null;
}

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  if (typeof value === 'string') {
    return new Error(value);
  }
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error(String(value));
  }
}

function DefaultFallback({ error, resetError }: ErrorFallbackProps) {
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = () => {
    setRefreshing(true);
    void refreshApp();
  };

  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-[hsl(var(--background))] p-5">
      <section className="w-full max-w-lg rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 text-center shadow-sm sm:p-8" role="alert" data-testid="global-error">
        <h1 className="font-serif text-2xl font-semibold text-[hsl(var(--foreground))]">
          Something went wrong
        </h1>
        <p className="mt-3 text-sm leading-6 text-[hsl(var(--muted-foreground))]">
          Try this page again, return to the start page, or refresh the app to
          request its latest files. Your saved offline farm data will stay in
          place.
        </p>
        {/* Dev only: messages can carry API responses and other internals. */}
        {import.meta.env.DEV ? (
          <pre className="mt-4 max-h-36 overflow-auto rounded bg-[hsl(var(--muted))] p-3 text-left text-xs text-[hsl(var(--foreground))]">
            {error.message || String(error)}
          </pre>
        ) : null}
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row sm:flex-wrap">
          <button type="button" onClick={resetError} className="rounded-xl bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-semibold text-[hsl(var(--primary-foreground))]" data-testid="button-try-error">
            Try again
          </button>
          <button type="button" onClick={() => goToStartPage()} className="rounded-xl border border-[hsl(var(--border))] px-4 py-2.5 text-sm font-semibold text-[hsl(var(--foreground))]" data-testid="button-start-error">
            Go to start page
          </button>
          <button type="button" onClick={handleRefresh} disabled={refreshing} className="rounded-xl border border-[hsl(var(--border))] px-4 py-2.5 text-sm font-semibold text-[hsl(var(--foreground))] disabled:opacity-50" data-testid="button-refresh-error">
            {refreshing ? 'Refreshing…' : 'Refresh app'}
          </button>
        </div>
      </section>
    </main>
  );
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: toError(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    if (this.props.logErrors === false) return;
    console.error(
      'ErrorBoundary caught an error:',
      toError(error),
      info.componentStack,
    );
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (
      this.state.error !== null &&
      prevProps.resetKey !== this.props.resetKey
    ) {
      this.resetError();
    }
  }

  resetError = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) {
      return this.props.children;
    }
    const Fallback = this.props.FallbackComponent ?? DefaultFallback;
    return <Fallback error={error} resetError={this.resetError} />;
  }
}
