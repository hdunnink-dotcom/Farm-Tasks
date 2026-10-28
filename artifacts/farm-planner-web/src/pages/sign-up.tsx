import { ClerkLoaded, ClerkLoading, SignUp } from "@clerk/react";
import { AuthPageShell } from "@/components/auth-page-shell";
import { ClerkAuthFallback } from "@/components/clerk-auth-fallback";
import { ErrorBoundary } from "@/components/error-boundary";
import { InvitationTicketGuard } from "@/components/invitation-ticket-guard";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export function getSafeRedirectUrl(): string {
  const candidate = new URLSearchParams(window.location.search).get('redirect_url');
  if (!candidate) return '/';
  try {
    const url = new URL(candidate, window.location.origin);
    if (url.origin !== window.location.origin) return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}

export default function SignUpPage() {
  const redirectUrl = getSafeRedirectUrl();
  const signInUrl = redirectUrl === '/'
    ? `${basePath}/sign-in`
    : `${basePath}/sign-in?redirect_url=${encodeURIComponent(redirectUrl)}`;
  return (
    <AuthPageShell>
        <ErrorBoundary FallbackComponent={ClerkAuthFallback} logErrors={false}>
        <ClerkLoading>
          <div className="w-full max-w-md rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-8" aria-busy="true" data-testid="clerk-sign-up-loading">
            <div className="h-6 w-44 animate-pulse rounded bg-[hsl(var(--muted))]" />
            <div className="mt-6 h-11 animate-pulse rounded-xl bg-[hsl(var(--muted))]" />
            <p className="mt-5 text-sm text-[hsl(var(--muted-foreground))]">Opening your farm invitation…</p>
          </div>
        </ClerkLoading>
        <ClerkLoaded>
          <InvitationTicketGuard>
            <SignUp
              routing="path"
              path={`${basePath}/sign-up`}
              signInUrl={signInUrl}
              fallbackRedirectUrl={redirectUrl}
            />
          </InvitationTicketGuard>
        </ClerkLoaded>
      </ErrorBoundary>
    </AuthPageShell>
  );
}
