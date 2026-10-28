import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

const DEFAULT_WAIT_MS = 6_000;

function hasRenderedAuthContent(node: HTMLElement): boolean {
  return Boolean(
    node.querySelector('form, input, button, [role="alert"], [data-localization-key]')
      || node.textContent?.trim(),
  );
}

export function InvitationTicketGuard({
  children,
  waitMs = DEFAULT_WAIT_MS,
}: {
  children: ReactNode;
  waitMs?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [timedOut, setTimedOut] = useState(false);
  const hasTicket = new URLSearchParams(window.location.search).has('__clerk_ticket');

  useEffect(() => {
    const container = containerRef.current;
    if (!hasTicket || !container) return;
    if (hasRenderedAuthContent(container)) return;

    const timer = window.setTimeout(() => {
      if (!hasRenderedAuthContent(container)) setTimedOut(true);
    }, waitMs);
    const observer = new MutationObserver(() => {
      if (hasRenderedAuthContent(container)) window.clearTimeout(timer);
    });
    observer.observe(container, { childList: true, subtree: true, characterData: true });

    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [hasTicket, waitMs]);

  if (timedOut) {
    return (
      <section className="w-full max-w-md rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-7 shadow-sm" role="alert" data-testid="invitation-ticket-recovery">
        <div className="mb-5 flex size-11 items-center justify-center rounded-full bg-[hsl(42_74%_64%/.18)] text-[hsl(26_55%_35%)]">
          <AlertTriangle size={22} aria-hidden="true" />
        </div>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">Account invitation</p>
        <h1 className="mt-2 font-serif text-3xl text-[hsl(var(--foreground))]">This invitation could not be accepted.</h1>
        <p className="mt-3 text-sm leading-6 text-[hsl(var(--muted-foreground))]">
          This link may have expired, already been used, or been replaced by a newer invitation. Ask the farm owner to resend it, then open only the newest email.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <button type="button" onClick={() => window.location.reload()} className="inline-flex items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-semibold text-[hsl(var(--primary-foreground))]" data-testid="button-retry-invitation">
            <RefreshCw size={16} aria-hidden="true" /> Try this link again
          </button>
          <a href={`${import.meta.env.BASE_URL}sign-in`} className="inline-flex items-center rounded-xl border border-[hsl(var(--border))] px-4 py-2.5 text-sm font-semibold text-[hsl(var(--foreground))]">
            Sign in instead
          </a>
        </div>
      </section>
    );
  }

  return <div ref={containerRef}>{children}</div>;
}