const ROUTE_RELOAD_STORAGE_KEY = 'farm-planner:route-reload';

type RouteReloadStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

interface RefreshRegistration {
  update: () => Promise<unknown>;
  waiting?: Pick<ServiceWorker, 'postMessage'> | null;
  installing?: Pick<ServiceWorker, 'postMessage'> | null;
}

interface RefreshServiceWorker {
  getRegistration: (scope?: string) => Promise<RefreshRegistration | undefined>;
}

export function startPageUrl(
  baseUrl = import.meta.env.BASE_URL,
  origin = window.location.origin,
): string {
  return new URL(baseUrl || '/', `${origin}/`).toString();
}

/** Uses document navigation so recovery does not depend on the React router. */
export function goToStartPage({
  baseUrl = import.meta.env.BASE_URL,
  origin = window.location.origin,
  assign = (url: string) => window.location.assign(url),
}: {
  baseUrl?: string;
  origin?: string;
  assign?: (url: string) => void;
} = {}): void {
  assign(startPageUrl(baseUrl, origin));
}

/**
 * Asks the browser for the latest worker and document before restarting.
 * Deliberately leaves Cache Storage and IndexedDB alone so offline field data
 * is not lost during recovery.
 */
export async function refreshApp({
  baseUrl = import.meta.env.BASE_URL,
  currentUrl = window.location.href,
  serviceWorker = 'serviceWorker' in navigator
    ? navigator.serviceWorker as RefreshServiceWorker
    : undefined,
  fetchDocument = (url: string) => fetch(url, {
    cache: 'reload',
    credentials: 'same-origin',
    headers: { 'Cache-Control': 'no-cache' },
  }),
  reload = () => window.location.reload(),
}: {
  baseUrl?: string;
  currentUrl?: string;
  serviceWorker?: RefreshServiceWorker;
  fetchDocument?: (url: string) => Promise<unknown>;
  reload?: () => void;
} = {}): Promise<void> {
  try {
    const registration = await serviceWorker?.getRegistration(baseUrl);
    if (registration) {
      await registration.update();
      // This also supports workers that do not call skipWaiting themselves.
      (registration.waiting ?? registration.installing)?.postMessage({
        type: 'SKIP_WAITING',
      });
    }
  } catch {
    // A worker update can fail offline. Still request the document and reload;
    // the existing worker may have a usable cached app shell.
  }

  try {
    await fetchDocument(currentUrl);
  } catch {
    // Reload remains useful offline because the worker can serve cached assets.
  } finally {
    reload();
  }
}

export function isRouteModuleLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /dynamically imported module|importing a module script failed|error loading dynamically imported module|failed to fetch dynamically imported module|unexpected token ['"]?</i.test(message);
}

export function attemptRouteModuleReload({
  storage = window.sessionStorage,
  reload = () => window.location.reload(),
}: {
  storage?: RouteReloadStorage;
  reload?: () => void;
} = {}): boolean {
  try {
    if (storage.getItem(ROUTE_RELOAD_STORAGE_KEY)) {
      storage.removeItem(ROUTE_RELOAD_STORAGE_KEY);
      return false;
    }

    storage.setItem(ROUTE_RELOAD_STORAGE_KEY, '1');
    reload();
    return true;
  } catch {
    // Storage and navigation can both be unavailable in restricted browsing
    // contexts. The original module error should remain visible in that case.
    return false;
  }
}

export function clearRouteModuleReloadGuard(
  storage: RouteReloadStorage = window.sessionStorage,
): void {
  try {
    storage.removeItem(ROUTE_RELOAD_STORAGE_KEY);
  } catch {
    // A storage failure must not turn a successful route load into an error.
  }
}