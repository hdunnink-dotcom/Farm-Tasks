import { lazy, Suspense, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ClerkProvider, useAuth, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { AlertTriangle, LogOut, RefreshCw } from 'lucide-react';
import {
  Redirect,
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';
import { apiErrorStatus, useMe } from '@/hooks/use-me';
import {
  attemptRouteModuleReload,
  clearRouteModuleReloadGuard,
  goToStartPage,
  isRouteModuleLoadError,
  refreshApp,
} from '@/lib/route-load-recovery';
import { AUTH_DISABLED } from '@/lib/auth-config';
import { notifyAuthRecovery } from '@/lib/offline-fieldbook';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, '');
const SIGN_IN_PATH = `${BASE_PATH}/sign-in`;
const SIGN_UP_PATH = `${BASE_PATH}/sign-up`;
const clerkPubKey = publishableKeyFromHost(window.location.hostname, PUBLISHABLE_KEY);
// The same-origin Clerk proxy only works with a Clerk production instance
// (pk_live_). Development instances (pk_test_) talk to Clerk directly.
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL
  || (import.meta.env.PROD && clerkPubKey?.startsWith('pk_live_') ? `${window.location.origin}${BASE_PATH}/api/__clerk` : undefined);

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY');
}

const queryClient = new QueryClient();

function lazyPage(loader: () => Promise<{ default: ComponentType }>) {
  return lazy(async () => {
    try {
      const page = await loader();
      clearRouteModuleReloadGuard();
      return page;
    } catch (error) {
      // A deployed PWA can briefly have an old document and a new route
      // chunk. Reload once so the service worker and module graph converge
      // instead of leaving the user at the generic error boundary.
      if (!isRouteModuleLoadError(error)) throw error;

      if (attemptRouteModuleReload()) {
        // The page is expected to unload immediately. Keeping this promise
        // pending prevents React from rendering a generic error in the brief
        // interval before the browser starts the reload.
        return await new Promise<never>(() => {});
      }
      throw error;
    }
  });
}

const NotFound = lazyPage(() => import('@/pages/not-found'));
const HomePage = lazyPage(() => import('@/pages/home'));
const TasksPage = lazyPage(() => import('@/pages/tasks'));
const WeekPage = lazyPage(() => import('@/pages/week'));
const SettingsPage = lazyPage(() => import('@/pages/settings'));
const AssistantPage = lazyPage(() => import('@/pages/assistant'));
const CrewPlanPage = lazyPage(() => import('@/pages/crew-plan'));
const SignInPage = lazyPage(() => import('@/pages/sign-in'));
const SignUpPage = lazyPage(() => import('@/pages/sign-up'));

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Suspense fallback={<PageLoading />}>
        <Switch>
            <Route path="/">{() => <ProtectedPage component={HomePage} />}</Route>
            <Route path="/tasks">{() => <ProtectedPage component={TasksPage} />}</Route>
            <Route path="/week">{() => <ProtectedPage component={WeekPage} />}</Route>
            <Route path="/settings">{() => <ProtectedPage component={SettingsPage} />}</Route>
            <Route path="/assistant">{() => <ProtectedPage component={AssistantPage} />}</Route>
            <Route path="/crew-plan">{() => <ProtectedPage component={CrewPlanPage} />}</Route>
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </RoutedErrorBoundary>
  );
}

function PageLoading() {
  return (
    <main aria-busy="true" aria-label="Loading Farm & Orchard Planner" style={{ minHeight: '100vh', padding: '2rem', background: 'hsl(var(--background))' }}>
      <div style={{ width: '9rem', height: '0.75rem', borderRadius: '999px', background: 'hsl(var(--muted))', marginBottom: '1.5rem' }} />
      <div style={{ width: '16rem', height: '2.25rem', borderRadius: '0.5rem', background: 'hsl(var(--muted))', marginBottom: '0.75rem' }} />
      <div style={{ width: '23rem', maxWidth: '100%', height: '1rem', borderRadius: '0.5rem', background: 'hsl(var(--muted))' }} />
    </main>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function stripBase(path: string): string {
  return BASE_PATH && path.startsWith(BASE_PATH)
    ? path.slice(BASE_PATH.length) || '/'
    : path;
}

function navigateClerk(to: string, replace: boolean, setLocation: ReturnType<typeof useLocation>[1]) {
  const destination = new URL(to, window.location.origin);
  const oauthAuthorizePath = `${BASE_PATH}/api/assistant/oauth/authorize` || '/api/assistant/oauth/authorize';
  if (destination.origin === window.location.origin && destination.pathname === oauthAuthorizePath) {
    if (replace) window.location.replace(destination.toString());
    else window.location.assign(destination.toString());
    return;
  }
  setLocation(stripBase(to), replace ? { replace: true } : undefined);
}

function ProtectedPage({ component: Page }: { component: ComponentType }) {
  const { isLoaded, isSignedIn } = useAuth();
  const returnUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const member = useMe(Boolean(isLoaded && isSignedIn));

  if (AUTH_DISABLED) return <Page />;
  if (!isLoaded || (isSignedIn && member.isLoading)) return <PageLoading />;
  if (!isSignedIn) {
    return <Redirect to={`/sign-in?redirect_url=${encodeURIComponent(returnUrl)}`} />;
  }
  if (member.isError) {
    return <FarmAccessError error={member.error} retry={() => void member.refetch()} retrying={member.isFetching} />;
  }
  return member.data ? <Page /> : <PageLoading />;
}

function FarmAccessError({ error, retry, retrying }: { error: unknown; retry: () => void; retrying: boolean }) {
  const clerk = useClerk();
  const [refreshing, setRefreshing] = useState(false);
  const status = apiErrorStatus(error);
  const awaitingApproval = status === 401 || status === 403;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[hsl(var(--background))] px-5 py-12">
      <section className="w-full max-w-lg rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-7 shadow-sm" role="alert" data-testid="farm-access-error">
        <div className="mb-5 flex size-11 items-center justify-center rounded-full bg-[hsl(42_74%_64%/.18)] text-[hsl(26_55%_35%)]">
          <AlertTriangle size={22} aria-hidden="true" />
        </div>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">Farm access</p>
        <h1 className="mt-2 font-serif text-3xl text-[hsl(var(--foreground))]">
          {awaitingApproval ? 'Your sign-in worked.' : 'We could not check your access.'}
        </h1>
        <p className="mt-3 text-sm leading-6 text-[hsl(var(--muted-foreground))]">
          {awaitingApproval
            ? 'This account is not connected to an approved farm member yet. If you received an invitation, finish signing up with that same email address and verify it, then try again.'
            : 'The farm server did not finish loading your account. Try again in a moment.'}
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <button type="button" onClick={retry} disabled={retrying} className="inline-flex items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-semibold text-[hsl(var(--primary-foreground))] disabled:opacity-50" data-testid="button-retry-farm-access">
            <RefreshCw size={16} className={retrying ? 'animate-spin' : ''} aria-hidden="true" />
            {retrying ? 'Checking…' : 'Try again'}
          </button>
          <button type="button" onClick={() => goToStartPage()} className="inline-flex items-center rounded-xl border border-[hsl(var(--border))] px-4 py-2.5 text-sm font-semibold text-[hsl(var(--foreground))]" data-testid="button-start-farm-access">
            Go to start page
          </button>
          <button type="button" onClick={() => {
            if (refreshing) return;
            setRefreshing(true);
            void refreshApp();
          }} disabled={refreshing} className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] px-4 py-2.5 text-sm font-semibold text-[hsl(var(--foreground))] disabled:opacity-50" data-testid="button-refresh-farm-access">
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" /> {refreshing ? 'Refreshing…' : 'Refresh app'}
          </button>
          <button type="button" onClick={() => void clerk.signOut({ redirectUrl: SIGN_IN_PATH })} className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] px-4 py-2.5 text-sm font-semibold text-[hsl(var(--foreground))]" data-testid="button-sign-out-farm-access">
            <LogOut size={16} aria-hidden="true" /> Sign out
          </button>
        </div>
      </section>
    </main>
  );
}

function AuthResumeRecovery() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const clerk = useClerk();
  const queryClient = useQueryClient();
  const hiddenAt = useRef<number | null>(null);
  const recovering = useRef(false);

  useEffect(() => {
    const recoverAfterResume = () => {
      if (!isLoaded || !isSignedIn || !userId || document.visibilityState !== 'visible') return;
      const wasAwayFor = hiddenAt.current === null ? 0 : Date.now() - hiddenAt.current;
      if (hiddenAt.current === null || wasAwayFor < 30_000 || recovering.current) return;

      hiddenAt.current = null;
      recovering.current = true;
      void (async () => {
        try {
          await clerk.session?.touch();
          notifyAuthRecovery(userId);
        } catch {
          // The fieldbook queue will surface a recovery action if renewal fails.
        }
        await queryClient.refetchQueries({ queryKey: ['me', userId], type: 'active' });
      })()
        .finally(() => { recovering.current = false; });
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now();
      } else {
        recoverAfterResume();
      }
    };
    const handlePageShow = () => recoverAfterResume();

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', handlePageShow);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [clerk, isLoaded, isSignedIn, queryClient, userId]);

  return null;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      touchSession
      signInUrl={SIGN_IN_PATH}
      signUpUrl={SIGN_UP_PATH}
      signUpFallbackRedirectUrl={BASE_PATH || '/'}
      signInFallbackRedirectUrl={BASE_PATH || '/'}
      routerPush={(to) => navigateClerk(to, false, setLocation)}
      routerReplace={(to) => navigateClerk(to, true, setLocation)}
    >
      <AppContent />
    </ClerkProvider>
  );
}

function AppContent() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthResumeRecovery />
      <TooltipProvider>
        <Router />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default function App() {
  return (
    <WouterRouter base={BASE_PATH}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}
