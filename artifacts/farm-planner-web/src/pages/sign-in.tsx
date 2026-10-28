import { ClerkLoaded, ClerkLoading, SignIn } from "@clerk/react";
import { AuthPageShell } from "@/components/auth-page-shell";
import { ClerkAuthFallback } from "@/components/clerk-auth-fallback";
import { ErrorBoundary } from "@/components/error-boundary";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function getSafeRedirectUrl(): string {
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

export default function SignInPage() {
  const redirectUrl = getSafeRedirectUrl();
  const signUpUrl = redirectUrl === '/'
    ? `${basePath}/sign-up`
    : `${basePath}/sign-up?redirect_url=${encodeURIComponent(redirectUrl)}`;
  return (
    <AuthPageShell>
        <ErrorBoundary FallbackComponent={ClerkAuthFallback} logErrors={false}>
        <ClerkLoading>
          <div className="w-full max-w-md rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-8" aria-busy="true" data-testid="clerk-sign-in-loading">
            <div className="h-6 w-36 animate-pulse rounded bg-[hsl(var(--muted))]" />
            <div className="mt-6 h-11 animate-pulse rounded-xl bg-[hsl(var(--muted))]" />
            <p className="mt-5 text-sm text-[hsl(var(--muted-foreground))]">Opening secure sign-in…</p>
          </div>
        </ClerkLoading>
        <ClerkLoaded>
          <SignIn
            routing="path"
            path={`${basePath}/sign-in`}
            signUpUrl={signUpUrl}
            fallbackRedirectUrl={redirectUrl}
          />
        </ClerkLoaded>
      </ErrorBoundary>
    </AuthPageShell>
  );
}
