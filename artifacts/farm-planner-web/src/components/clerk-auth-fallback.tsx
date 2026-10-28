import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { ErrorFallbackProps } from '@/components/error-boundary';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export function ClerkAuthFallback({ resetError }: ErrorFallbackProps) {
  return (
    <section className="w-full max-w-md rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-7 shadow-sm" role="alert" data-testid="clerk-auth-error">
      <div className="mb-5 flex size-11 items-center justify-center rounded-full bg-[hsl(42_74%_64%/.18)] text-[hsl(26_55%_35%)]">
        <AlertTriangle size={22} aria-hidden="true" />
      </div>
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">Account invitation</p>
      <h1 className="mt-2 font-serif text-3xl text-[hsl(var(--foreground))]">This sign-up link could not open.</h1>
      <p className="mt-3 text-sm leading-6 text-[hsl(var(--muted-foreground))]">
        The invitation may be incomplete, expired, or already used. Try loading it once more. If it still fails, ask the farm owner to resend your invitation and use only the newest email.
      </p>
      <div className="mt-7 flex flex-wrap items-center gap-3">
        <button type="button" onClick={resetError} className="inline-flex items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-semibold text-[hsl(var(--primary-foreground))]" data-testid="button-retry-clerk-auth">
          <RefreshCw size={16} aria-hidden="true" /> Try again
        </button>
        <a href={`${basePath}/sign-in`} className="inline-flex items-center rounded-xl border border-[hsl(var(--border))] px-4 py-2.5 text-sm font-semibold text-[hsl(var(--foreground))]" data-testid="link-sign-in-from-clerk-error">
          Sign in instead
        </a>
      </div>
    </section>
  );
}