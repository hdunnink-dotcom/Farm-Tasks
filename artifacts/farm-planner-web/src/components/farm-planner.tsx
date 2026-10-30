import { Link, useLocation } from 'wouter';
import { useAuth, UserButton } from '@clerk/react';
import { useMe } from '@/hooks/use-me';
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  ClipboardList,
  Map,
  Bot,
  Cloud,
  ExternalLink,
  Leaf,
  Loader2,
  MapPin,
  Menu,
  Paperclip,
  RefreshCw,
  Settings2,
  Sheet,
  Sprout,
  Sunrise,
  Trash2,
  Wifi,
  X,
  Maximize2,
  Users,
} from 'lucide-react';
import { useState, useEffect, useRef, type ReactNode } from 'react';
import { getListFarmTasksQueryKey, type FarmTask, useListFarmTasks } from '@workspace/api-client-react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import * as Dialog from '@radix-ui/react-dialog';
import type { FieldbookConflict } from '@/lib/offline-fieldbook';
import { googleMapsUrl, hasTaskCoordinates, isSafeExternalUrl } from '@/lib/task-map-links';
import { formatTaskScheduledDates } from '@/lib/task-calendar';
import { formatCoordinatePair } from '@/lib/coordinates';
import { goToStartPage, refreshApp } from '@/lib/route-load-recovery';

export function FieldMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3" data-testid="brand-field-mark">
      <div className="relative flex size-10 shrink-0 items-center justify-center rounded-[13px] border border-[hsl(42_74%_64%/.35)] bg-[hsl(42_74%_64%/.12)] text-[hsl(var(--sidebar-primary))]">
        <Sprout size={22} strokeWidth={1.7} />
        <span className="absolute bottom-[7px] h-px w-5 bg-[hsl(var(--sidebar-primary)/.55)]" />
      </div>
      {!compact && (
        <div className="leading-none">
          <p className="font-serif text-[1.1rem] tracking-[-.02em] text-[hsl(var(--sidebar-foreground))]">Fieldbook</p>
          <p className="mt-1 font-mono text-[9px] uppercase tracking-[.17em] text-[hsl(42_28%_70%)]">Orchard + pasture</p>
        </div>
      )}
    </div>
  );
}

function Navigation({ mobile = false }: { mobile?: boolean }) {
  const [location] = useLocation();
  const { isLoaded, isSignedIn } = useAuth();
  const { data: me } = useMe(Boolean(isLoaded && isSignedIn));

  const items = [
    { href: '/', label: 'Today', mobileLabel: 'Today', icon: Sunrise },
    { href: '/week', label: 'Weekly route', mobileLabel: 'Week', icon: Map },
    { href: '/tasks', label: 'All tasks', mobileLabel: 'Tasks', icon: ClipboardList },
    ...(me ? [{ href: '/crew-plan', label: 'Crew plan', mobileLabel: 'Crew', icon: Users, managerOnlyOnDesktop: true }] : []),
    { href: '/assistant', label: 'Assistant', mobileLabel: 'Bot', icon: Bot },
    { href: '/settings', label: 'Settings', mobileLabel: 'Settings', icon: Settings2 },
  ];

  return (
    <nav className={mobile ? 'mobile-nav fixed bottom-0 left-0 right-0 z-40 border-t border-[hsl(var(--border))] bg-[hsl(42_45%_97%/.96)] px-2 pb-[max(.65rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur-md' : 'mt-14 space-y-2'} aria-label="Main navigation">
      <div className={mobile ? 'mx-auto flex w-full max-w-md items-center justify-around' : 'space-y-2'}>
        {items.map(({ href, label, mobileLabel, icon: Icon, managerOnlyOnDesktop }) => {
          if (!mobile && managerOnlyOnDesktop && !me?.isHarnold) return null;
          const active = href === '/' ? location === '/' : location.startsWith(href);
          return (
            <Link
              href={href}
              key={href}
              aria-current={active ? 'page' : undefined}
              data-testid={`link-nav-${label.toLowerCase().replace(' ', '-')}`}
              className={mobile
                ? `flex min-h-[44px] min-w-[44px] flex-1 flex-col items-center justify-center gap-1 rounded-xl py-1 text-[10px] font-medium transition-colors ${active ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--muted-foreground))]'}`
                : `group flex min-h-[44px] items-center gap-3 rounded-xl px-3 py-3 text-sm transition-colors ${active ? 'bg-[hsl(var(--sidebar-accent))] text-[hsl(var(--sidebar-accent-foreground))]' : 'text-[hsl(42_20%_70%)] hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-accent-foreground))]'}`}
            >
              <Icon size={mobile ? 20 : 18} strokeWidth={active ? 2.2 : 1.7} />
              <span>{mobile ? mobileLabel : label}</span>
              {!mobile && active && <span className="ml-auto size-1.5 rounded-full bg-[hsl(var(--sidebar-primary))]" />}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export type PlannerSyncStatus = {
  online: boolean;
  syncing: boolean;
  retrying: boolean;
  pendingCount: number;
  failedCount?: number;
  conflictCount?: number;
  sourceUrl?: string;
};

function syncStatusLabel(status?: PlannerSyncStatus): string {
  if (!status) return 'Connected';
  if (!status.online) return status.pendingCount ? `Offline · ${status.pendingCount} pending` : 'Offline';
  if (status.conflictCount) return `${status.conflictCount} conflict${status.conflictCount === 1 ? '' : 's'}`;
  if (status.failedCount) return `${status.failedCount} change${status.failedCount === 1 ? '' : 's'} need attention`;
  if (status.retrying) return status.pendingCount ? `Retrying · ${status.pendingCount} pending` : 'Retrying';
  if (status.syncing) return 'Syncing';
  if (status.pendingCount) return `${status.pendingCount} pending`;
  return 'Up to date';
}

export function PlannerShell({
  children,
  loadSourceQuery = true,
  syncStatus,
}: {
  children: ReactNode;
  loadSourceQuery?: boolean;
  syncStatus?: PlannerSyncStatus;
}) {
  const { isSignedIn, isLoaded } = useAuth();
  const [browserOnline, setBrowserOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  useEffect(() => {
    const handleOnline = () => setBrowserOnline(true);
    const handleOffline = () => setBrowserOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);
  const sourceQuery = useListFarmTasks(
    { includeDone: true },
    {
      query: {
        queryKey: [...getListFarmTasksQueryKey({ includeDone: true }), 'planner-shell-source'],
        enabled: loadSourceQuery && Boolean(isLoaded && isSignedIn),
        staleTime: 5 * 60 * 1000,
      },
    },
  );
  const sheetUrlCandidate = syncStatus?.sourceUrl ?? sourceQuery.data?.sourceUrl;
  const sheetUrl = isSafeExternalUrl(sheetUrlCandidate) ? sheetUrlCandidate : undefined;
  const effectiveSyncStatus = syncStatus ?? {
    online: browserOnline,
    syncing: false,
    retrying: false,
    pendingCount: 0,
  };
  const statusLabel = syncStatusLabel(effectiveSyncStatus);
  const statusNeedsAttention = Boolean(
    !effectiveSyncStatus.online
    || effectiveSyncStatus.retrying
    || effectiveSyncStatus.pendingCount
    || (effectiveSyncStatus.failedCount ?? 0) > 0
    || (effectiveSyncStatus.conflictCount ?? 0) > 0
  );
  
  return (
    <div className="grain planner-shell">
      <aside className="planner-sidebar flex flex-col px-7 py-7">
        <Link href="/" data-testid="link-brand-home" className="block">
          <FieldMark />
        </Link>
        <Navigation />
        <div className="mt-auto border-t border-[hsl(var(--sidebar-border))] pt-5">
          <div className="mb-4 flex items-center gap-3">
            {isLoaded && isSignedIn && <UserButton />}
            {isLoaded && !isSignedIn && (
              <Link href="/sign-in" className="rounded-lg border border-[hsl(42_74%_64%/.45)] px-3 py-2 text-xs font-semibold text-[hsl(42_20%_78%)] hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-foreground))]" data-testid="link-sign-in">
                Sign in to connect Claude
              </Link>
            )}
          </div>
           {loadSourceQuery && (sheetUrl ? <a href={sheetUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.13em] text-[hsl(42_20%_65%)] hover:text-[hsl(var(--sidebar-primary))]" data-testid="link-sheet-connected">
             <span className="size-2 rounded-full bg-[hsl(76_44%_55%)] shadow-[0_0_0_3px_hsl(76_44%_55%/.13)]" />
             Sheet connected
           </a> : <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.13em] text-[hsl(42_20%_55%)]" data-testid="text-sheet-unavailable"><span className="size-2 rounded-full bg-[hsl(35_62%_56%)]" />Sheet link unavailable</span>)}
          <p className="mt-3 max-w-[175px] text-xs leading-5 text-[hsl(42_15%_60%)]">The connected Google Sheet keeps the crew in step, wherever the work happens.</p>
        </div>
      </aside>
      <main className="planner-main">
        <header className="mobile-topbar items-center justify-between border-b border-[hsl(var(--border))] bg-[hsl(42_45%_97%/.92)] px-5 py-4 backdrop-blur-md">
          <Link href="/" data-testid="link-mobile-brand"><FieldMark compact /></Link>
          <div className="flex items-center gap-4">
            <div className="flex max-w-[11rem] items-center gap-2 font-mono text-[9px] uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]" aria-live="polite" data-testid="mobile-sync-status">
              <span className={`size-2 shrink-0 rounded-full ${statusNeedsAttention ? 'bg-[hsl(var(--accent))]' : 'bg-[hsl(76_44%_45%)]'}`} />
              <span className="truncate">{statusLabel}</span>
            </div>
            {isLoaded && isSignedIn && <UserButton />}
            {isLoaded && !isSignedIn && (
              <Link href="/sign-in" className="text-xs font-semibold text-[hsl(var(--primary))]" data-testid="link-mobile-sign-in">
                Sign in
              </Link>
            )}
          </div>
        </header>
        {children}
        <Navigation mobile />
      </main>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: ReactNode;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-col justify-between gap-5 md:mb-10 md:flex-row md:items-end">
      <div>
        <p className="mb-3 flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[.2em] text-[hsl(var(--muted-foreground))]"><span className="h-px w-6 bg-[hsl(var(--accent))]" />{eyebrow}</p>
        <h1 className="font-serif text-4xl font-semibold leading-[1.05] tracking-[-.035em] text-[hsl(var(--foreground))] md:text-5xl">{title}</h1>
        {description && <p className="mt-3 max-w-[60ch] text-[15px] leading-relaxed text-[hsl(var(--muted-foreground))]">{description}</p>}
      </div>
      {action}
    </header>
  );
}

export function SourcePill({ source }: { source?: string }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-[hsl(76_28%_67%/.55)] bg-[hsl(76_35%_92%/.7)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[.08em] text-[hsl(155_28%_29%)]" data-testid="status-source">
      <Sheet size={13} strokeWidth={1.8} />
      <span>{source ? `Source: ${source}` : 'Google Sheet source'}</span>
      <span className="size-1.5 rounded-full bg-[hsl(76_44%_45%)]" />
    </div>
  );
}

export function UrgencyPill({ urgency, onCycle }: { urgency: 'Urgent' | 'Low' | 'Medium' | 'High'; onCycle?: () => void }) {
  const styles = {
    Urgent: 'bg-[hsl(0_72%_48%/.15)] text-[hsl(0_65%_38%)] border-[hsl(0_65%_48%/.3)]',
    High: 'bg-[hsl(5_61%_49%/.11)] text-[hsl(5_61%_42%)] border-[hsl(5_61%_49%/.22)]',
    Medium: 'bg-[hsl(35_82%_66%/.2)] text-[hsl(26_55%_35%)] border-[hsl(35_62%_56%/.3)]',
    Low: 'bg-[hsl(156_28%_28%/.09)] text-[hsl(156_28%_28%)] border-[hsl(156_28%_28%/.18)]',
  };
  const className = `inline-flex rounded-full border px-2 py-1 font-mono text-[9px] uppercase tracking-[.12em] ${styles[urgency]}`;
  return onCycle ? (
    <button type="button" onClick={onCycle} className={`${className} cursor-pointer transition-transform hover:-translate-y-0.5`} aria-label={`Priority ${urgency}. Click to change priority.`} data-testid={`button-cycle-priority-${urgency.toLowerCase()}`}>{urgency}</button>
  ) : <span className={className} data-testid={`status-urgency-${urgency.toLowerCase()}`}>{urgency}</span>;
}

export function SyncNotice({ syncing = false, message }: { syncing?: boolean; message?: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px] text-[hsl(var(--muted-foreground))]" data-testid="status-sync">
      {syncing ? <Loader2 className="animate-spin" size={14} /> : <Cloud size={14} />}
      <span>{message || (syncing ? 'Saving to connected sheet…' : 'Edits stay aligned with Google Sheets')}</span>
    </div>
  );
}

export function RetryPendingChangesButton({
  pendingCount,
  syncing = false,
  onRetry,
  testId,
}: {
  pendingCount: number;
  syncing?: boolean;
  onRetry: () => void | Promise<void>;
  testId: string;
}) {
  if (pendingCount < 1) return null;
  return (
    <button
      type="button"
      onClick={() => void onRetry()}
      disabled={syncing}
      data-testid={testId}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-[hsl(var(--accent)/.55)] bg-[hsl(var(--accent)/.12)] px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[.06em] text-[hsl(var(--accent-foreground))] hover:bg-[hsl(var(--accent)/.22)] disabled:opacity-50"
    >
      <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
      Retry pending changes
    </button>
  );
}

const conflictFields: Array<{
  label: string;
  value: (task: FieldbookConflict['localTask']) => unknown;
}> = [
  { label: 'Task name', value: (task) => task.task },
  { label: 'Completed', value: (task) => task.done },
  { label: 'Work group', value: (task) => task.group },
  { label: 'Priority', value: (task) => task.urgency },
  { label: 'Schedule', value: (task) => formatTaskScheduledDates(task) ?? task.calendarStart },
  { label: 'Repeat', value: (task) => task.recurrence ?? (task.repeatWeekly ? 'weekly' : 'none') },
  { label: 'Month', value: (task) => task.month },
  { label: 'Location', value: (task) => task.location },
  { label: 'Coordinates', value: (task) => task.latitude === null || task.latitude === undefined || task.longitude === null || task.longitude === undefined ? '' : `${task.latitude}, ${task.longitude}` },
  { label: 'Location captured', value: (task) => task.locationCapturedAt ?? '' },
  { label: 'Atlas link', value: (task) => task.atlasLink ?? '' },
  { label: 'Notes', value: (task) => task.notes },
  { label: 'Reference link', value: (task) => task.link },
  { label: 'Steps', value: (task) => task.subtasks.map((step) => `${step.done ? 'Done' : 'Open'}: ${step.title}`) },
  { label: 'Assigned team', value: (task) => task.assigneeNames?.length ? task.assigneeNames : task.assigneeName ? [task.assigneeName] : [] },
];

function conflictValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length ? value.join('\n') : '—';
  const text = String(value ?? '').trim();
  return text || '—';
}

export function ConflictNotice({ conflicts, onResolve }: { conflicts: FieldbookConflict[]; onResolve: (conflict: FieldbookConflict, choice: 'local' | 'server') => void }) {
  const [comparingId, setComparingId] = useState('');
  if (!conflicts.length) return null;
  return <div className="mb-6 space-y-3" data-testid="status-conflicts">
    {conflicts.map((conflict) => {
      const differences = conflictFields.flatMap((field) => {
        const local = conflictValue(field.value(conflict.localTask));
        const server = conflictValue(field.value(conflict.serverTask));
        return local === server ? [] : [{ label: field.label, local, server }];
      });
      const comparing = comparingId === conflict.id;
      return <div key={conflict.id} className="rounded-xl border border-[hsl(35_72%_52%/.45)] bg-[hsl(35_82%_66%/.16)] px-4 py-3 text-xs text-[hsl(var(--foreground))]">
        <p className="font-semibold">This task changed elsewhere: “{conflict.localTask.task}”</p>
        <p className="mt-1 text-[hsl(var(--muted-foreground))]">Your pending edit is saved. Compare the changes, then choose which version belongs in the fieldbook.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => setComparingId(comparing ? '' : conflict.id)} aria-expanded={comparing} data-testid={`button-compare-conflict-${conflict.id}`} className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 font-semibold">{comparing ? 'Hide comparison' : 'Compare changes'}</button>
          <button type="button" onClick={() => onResolve(conflict, 'local')} className="rounded-lg bg-[hsl(var(--primary))] px-3 py-2 font-semibold text-[hsl(var(--primary-foreground))]">Keep my version</button>
          <button type="button" onClick={() => onResolve(conflict, 'server')} className="rounded-lg border border-[hsl(var(--border))] px-3 py-2 font-semibold">Use newer sheet version</button>
        </div>
        {comparing && <div className="mt-4 overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]" data-testid={`conflict-comparison-${conflict.id}`}>
          <div className="grid grid-cols-[minmax(90px,.75fr)_minmax(0,1fr)_minmax(0,1fr)] border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.55)] font-semibold">
            <div className="px-3 py-2">Changed field</div>
            <div className="border-l border-[hsl(var(--border))] px-3 py-2">My version</div>
            <div className="border-l border-[hsl(var(--border))] px-3 py-2">Newer sheet version</div>
          </div>
          {differences.length ? differences.map((difference) => <div key={difference.label} className="grid grid-cols-[minmax(90px,.75fr)_minmax(0,1fr)_minmax(0,1fr)] border-b border-[hsl(var(--border))] last:border-b-0">
            <div className="px-3 py-2 font-semibold text-[hsl(var(--muted-foreground))]">{difference.label}</div>
            <div className="whitespace-pre-wrap break-words border-l border-[hsl(var(--border))] px-3 py-2">{difference.local}</div>
            <div className="whitespace-pre-wrap break-words border-l border-[hsl(var(--border))] px-3 py-2">{difference.server}</div>
          </div>) : <p className="px-3 py-3 text-[hsl(var(--muted-foreground))]">The saved task fields match. Only the sheet update time changed.</p>}
        </div>}
      </div>;
    })}
  </div>;
}

export function ErrorState({ onRetry, message = 'The tasks could not be loaded.' }: { onRetry: () => void; message?: string }) {
  const [refreshing, setRefreshing] = useState(false);
  return (
    <div className="rounded-2xl border border-[hsl(5_61%_49%/.25)] bg-[hsl(5_61%_49%/.06)] p-8 text-center" data-testid="state-error">
      <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-[hsl(5_61%_49%/.12)] text-[hsl(var(--destructive))]"><Wifi size={19} /></div>
      <h2 className="mt-4 font-serif text-xl text-[hsl(var(--foreground))]">The line went quiet</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[hsl(var(--muted-foreground))]">{message} Check the connection, then try again.</p>
      <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row sm:flex-wrap">
        <button type="button" onClick={onRetry} data-testid="button-retry" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-semibold text-[hsl(var(--primary-foreground))] transition-transform hover:-translate-y-0.5"><ArrowUpRight size={15} /> Try again</button>
        <button type="button" onClick={() => goToStartPage()} data-testid="button-error-start" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-2.5 text-sm font-semibold text-[hsl(var(--foreground))]">Go to start page</button>
        <button type="button" onClick={() => { if (!refreshing) { setRefreshing(true); void refreshApp(); } }} disabled={refreshing} data-testid="button-error-refresh-app" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-2.5 text-sm font-semibold text-[hsl(var(--foreground))] disabled:opacity-50"><RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />{refreshing ? 'Refreshing…' : 'Refresh app'}</button>
      </div>
    </div>
  );
}

export function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="paper-grid rounded-2xl border border-dashed border-[hsl(var(--border))] px-6 py-14 text-center" data-testid="state-empty">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-[hsl(var(--accent)/.22)] text-[hsl(var(--primary))]"><Leaf size={21} /></div>
      <h2 className="mt-4 font-serif text-2xl text-[hsl(var(--foreground))]">A clear patch of ground</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[hsl(var(--muted-foreground))]">There are no tasks here yet. Add the first bit of work and give the crew a place to start.</p>
      <button type="button" onClick={onAdd} data-testid="button-empty-add-task" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-semibold text-[hsl(var(--primary-foreground))]"><ClipboardList size={16} /> Add a task</button>
    </div>
  );
}

export function StatCard({ label, value, detail, icon: Icon, accent = false, active = false, onClick }: { label: string; value: number | string; detail: string; icon: typeof CalendarDays; accent?: boolean; active?: boolean; onClick?: () => void }) {
  return (
    <div role={onClick ? 'tab' : undefined} aria-selected={onClick ? active : undefined} tabIndex={onClick ? 0 : undefined} onClick={onClick} onKeyDown={(event) => { if (onClick && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onClick(); } }} className={`rounded-2xl border p-5 ${onClick ? 'cursor-pointer transition-all hover:-translate-y-0.5 hover:border-[hsl(var(--primary)/.55)]' : ''} ${active ? 'border-[hsl(var(--primary))] ring-2 ring-[hsl(var(--primary)/.15)]' : ''} ${accent ? 'border-[hsl(35_62%_56%/.45)] bg-[hsl(35_82%_66%/.16)]' : 'border-[hsl(var(--border))] bg-[hsl(var(--card))]'}`} data-testid={`stat-${label.toLowerCase().replaceAll(' ', '-')}`}>
      <div className="flex items-start justify-between"><p className="font-mono text-[10px] uppercase tracking-[.13em] text-[hsl(var(--muted-foreground))]">{label}</p><Icon size={17} className="text-[hsl(var(--primary))]" strokeWidth={1.7} /></div>
      <p className="mt-5 font-serif text-4xl tracking-[-.04em] text-[hsl(var(--foreground))]">{value}</p>
      <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{detail}</p>
    </div>
  );
}

export function TaskSkeleton({ count = 3 }: { count?: number }) {
  return <div className="space-y-3" data-testid="state-loading">{Array.from({ length: count }).map((_, index) => <div key={index} className="h-[93px] animate-pulse rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/.6)]" />)}</div>;
}

export function TaskCard({ task, onToggle, onEdit, onDelete, onOpen, onToggleSubtask, onCycleUrgency, compact = false }: { task: FarmTask; onToggle: (done: boolean) => void; onEdit: () => void; onDelete: () => void; onOpen?: () => void; onToggleSubtask?: (subtaskId: string, done: boolean) => void; onCycleUrgency?: () => void; compact?: boolean; }) {
  const mapsUrl = googleMapsUrl(task);
  const scheduledLabel = formatTaskScheduledDates(task);
  const assigneeNames = task.assigneeNames?.length ? task.assigneeNames : task.assigneeName ? [task.assigneeName] : [];
  return (
    <article onClick={onOpen} onKeyDown={(event) => { if (event.target === event.currentTarget && onOpen && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onOpen(); } }} tabIndex={onOpen ? 0 : undefined} className={`task-card group relative border ${compact ? 'rounded-xl px-3 py-3 md:px-4' : 'rounded-2xl p-4'} ${onOpen ? 'cursor-pointer' : ''} ${task.done ? 'border-[hsl(var(--border))] bg-[hsl(var(--muted)/.48)]' : 'border-[hsl(var(--border))] bg-[hsl(var(--card))]'}`} data-testid={`card-task-${task.id}`}>
      <div className="flex items-start gap-3">
        <button type="button" onClick={(event) => { event.stopPropagation(); onToggle(!task.done); }} aria-label={task.done ? `Reopen ${task.task}` : `Complete ${task.task}`} data-testid={`button-toggle-task-${task.id}`} className={`mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-full border transition-all ${task.done ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'border-[hsl(var(--border))] bg-[hsl(var(--background))] text-transparent hover:border-[hsl(var(--primary))] hover:text-[hsl(var(--primary))]'}`}><Check size={17} strokeWidth={2.5} /></button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><span className={`font-mono text-[9px] uppercase tracking-[.13em] ${task.done ? 'text-[hsl(var(--muted-foreground))]' : 'text-[hsl(var(--primary))]'}`}>{task.group || 'General'}</span><UrgencyPill urgency={task.urgency} onCycle={onCycleUrgency} /></div>
          <h3 className={`${compact ? 'mt-1' : 'mt-2'} pr-2 text-[15px] font-semibold leading-6 ${task.done ? 'text-[hsl(var(--muted-foreground))] line-through decoration-[hsl(var(--accent))]' : 'text-[hsl(var(--foreground))]'}`}>{task.task}</h3>

          {!compact && task.notes && (
            <p className="mt-2 max-w-[65ch] text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">{task.notes}</p>
          )}

          {!compact && task.subtasks?.length > 0 && (
            <ul className="mt-4 space-y-2">
              {task.subtasks.map(st => (
                <li key={st.id} className="flex items-start gap-2">
                  <button 
                    type="button" 
                    aria-label={st.done ? `Reopen subtask: ${st.title}` : `Complete subtask: ${st.title}`}
                    onClick={(event) => { event.stopPropagation(); onToggleSubtask?.(st.id, !st.done); }}
                    disabled={!onToggleSubtask || task.done}
                    className={`flex size-8 shrink-0 items-center justify-center rounded-lg border transition-all ${st.done ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'border-[hsl(var(--border))] bg-[hsl(var(--background))] text-transparent hover:border-[hsl(var(--primary))]'} disabled:cursor-not-allowed`}
                  >
                    <Check size={10} strokeWidth={3} />
                  </button>
                  <span className={`text-xs ${st.done ? 'text-[hsl(var(--muted-foreground))] line-through' : 'text-[hsl(var(--foreground))]'}`}>{st.title}</span>
                </li>
              ))}
            </ul>
          )}

          <div className={`${compact ? 'mt-2' : 'mt-4'} flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-[hsl(var(--muted-foreground))]`}>
            <span className="inline-flex items-center gap-1 font-medium text-[hsl(var(--primary))]">{assigneeNames.length ? `Assigned to ${assigneeNames.join(', ')}` : 'Unassigned'}</span>
            {task.subtasks?.length > 0 && <span>{task.subtasks.filter((step) => step.done).length}/{task.subtasks.length} steps</span>}
            <span className="inline-flex items-center gap-1"><MapPin size={12} />{task.location || 'Field'}</span>
            {mapsUrl && <a href={mapsUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} data-testid={`open-task-map-${task.id}`} className="inline-flex items-center gap-1 text-[hsl(var(--primary))] hover:underline"><ArrowUpRight size={12} /> Map pin</a>}
             {scheduledLabel ? <span className="inline-flex items-center gap-1" data-testid={`task-schedule-${task.id}`}><CalendarDays size={12} />{scheduledLabel}</span> : task.month && <span className="inline-flex items-center gap-1"><CalendarDays size={12} />{task.month}</span>}
            {task.link && (
              <a href={task.link} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} className="inline-flex items-center gap-1 text-[hsl(var(--primary))] hover:underline">
                <ExternalLink size={12} /> Link
              </a>
            )}
            {task.attachments?.length > 0 && (
              <span className="inline-flex items-center gap-1"><Paperclip size={12} /> {task.attachments.length} attached</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-1 opacity-100 transition-opacity">
          <button type="button" onClick={(event) => { event.stopPropagation(); onEdit(); }} data-testid={`button-edit-task-${task.id}`} className="flex size-11 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]" aria-label={`Edit ${task.task}`}><Settings2 size={17} /></button>
          <AlertDialog.Root>
            <AlertDialog.Trigger asChild>
              <button type="button" aria-label={`Delete ${task.task}`} onClick={(event) => event.stopPropagation()} data-testid={`button-delete-task-${task.id}`} className={`${compact ? 'hidden sm:flex' : 'flex'} size-11 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-[hsl(5_61%_49%/.1)] hover:text-[hsl(var(--destructive))]`}><Trash2 size={17} /></button>
            </AlertDialog.Trigger>
            <AlertDialog.Portal>
              <AlertDialog.Overlay className="modal-backdrop fixed inset-0 z-50" />
              <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-2xl">
                <AlertDialog.Title className="font-serif text-2xl text-[hsl(var(--foreground))]">Delete task?</AlertDialog.Title>
                <AlertDialog.Description className="mt-3 text-sm leading-6 text-[hsl(var(--muted-foreground))]">
                  This will permanently remove "{task.task}" and its subtasks from the fieldbook. This action cannot be undone.
                </AlertDialog.Description>
                <div className="mt-6 flex justify-end gap-3">
                  <AlertDialog.Cancel asChild>
                    <button type="button" className="rounded-xl px-4 py-2.5 text-sm font-semibold text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]">Cancel</button>
                  </AlertDialog.Cancel>
                  <AlertDialog.Action asChild>
                    <button type="button" onClick={onDelete} className="rounded-xl bg-[hsl(var(--destructive))] px-4 py-2.5 text-sm font-semibold text-[hsl(var(--destructive-foreground))] transition-transform hover:-translate-y-0.5">Delete</button>
                  </AlertDialog.Action>
                </div>
              </AlertDialog.Content>
            </AlertDialog.Portal>
          </AlertDialog.Root>
        </div>
      </div>
    </article>
  );
}

export function TaskDetailsDialog({ task, onClose }: { task?: FarmTask; onClose: () => void }) {
  const [fullScreenPhoto, setFullScreenPhoto] = useState<string | null>(null);
  const photoTriggerRef = useRef<HTMLButtonElement | null>(null);
  if (!task) return null;
  const photos = task.attachments.filter((file) => file.contentType.startsWith('image/'));
  const files = task.attachments.filter((file) => !file.contentType.startsWith('image/'));
  const mapsUrl = googleMapsUrl(task);
  const scheduledLabel = formatTaskScheduledDates(task);
  const assigneeNames = task.assigneeNames?.length ? task.assigneeNames : task.assigneeName ? [task.assigneeName] : [];
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-backdrop fixed inset-0 z-50" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] w-full overflow-y-auto rounded-t-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-2xl outline-none lg:bottom-auto lg:left-1/2 lg:top-1/2 lg:max-w-2xl lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-[1.75rem]">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-[hsl(var(--border))] bg-[hsl(42_45%_97%/.95)] px-5 py-4 backdrop-blur-md lg:px-7">
          <div><p className="font-mono text-[10px] uppercase tracking-[.17em] text-[hsl(var(--muted-foreground))]">Task details</p><Dialog.Title className="mt-1 font-serif text-3xl leading-tight text-[hsl(var(--foreground))]">{task.task}</Dialog.Title></div>
          <Dialog.Close asChild><button type="button" aria-label="Close task details" data-testid="button-close-task-details" className="flex size-11 shrink-0 items-center justify-center rounded-full text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"><X size={19} /></button></Dialog.Close>
        </div>
        <Dialog.Description className="sr-only">Task information, attachments, location, and schedule.</Dialog.Description>
        <div className="space-y-6 px-5 py-6 lg:px-7">
          <div className="flex flex-wrap gap-2"><UrgencyPill urgency={task.urgency} /><span className="rounded-full bg-[hsl(var(--muted))] px-3 py-1.5 text-xs font-semibold">{task.group}</span>{assigneeNames.map((name, index) => <span key={`${name}-${index}`} className="rounded-full bg-[hsl(76_35%_92%/.7)] px-3 py-1.5 text-xs font-semibold">Assigned to {name}</span>)}</div>
           <div className="grid gap-4 text-sm sm:grid-cols-2"><Detail label="Location" value={task.location || 'Not specified'} />{hasTaskCoordinates(task) && <Detail label="GPS pin" value={formatCoordinatePair(task.latitude, task.longitude)} />}<Detail label="Scheduled" value={scheduledLabel || 'Not scheduled'} /><Detail label="Month" value={task.month || 'Not selected'} /><Detail label="Status" value={task.done ? 'Completed' : 'Open'} /><Detail label="Source" value={task.source} /></div>
          {(mapsUrl || isSafeExternalUrl(task.atlasLink)) && <div className="flex flex-wrap gap-2">{mapsUrl && <a href={mapsUrl} target="_blank" rel="noreferrer" data-testid={`open-task-map-${task.id}`} className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-3 py-2 text-xs font-semibold text-[hsl(var(--primary))] hover:bg-[hsl(var(--secondary))]"><MapPin size={14} />Open in Google Maps</a>}{isSafeExternalUrl(task.atlasLink) && <a href={task.atlasLink} target="_blank" rel="noreferrer" data-testid={`open-task-atlas-${task.id}`} className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-3 py-2 text-xs font-semibold text-[hsl(var(--primary))] hover:bg-[hsl(var(--secondary))]"><ArrowUpRight size={14} />Open Atlas map</a>}</div>}
          {task.notes && <div><p className="detail-label">Notes</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[hsl(var(--foreground))]">{task.notes}</p></div>}
          {task.subtasks.length > 0 && <div><p className="detail-label">Steps</p><ul className="mt-2 space-y-2">{task.subtasks.map((step) => <li key={step.id} className="flex items-center gap-2 text-sm"><span className={`flex size-5 items-center justify-center rounded-full border ${step.done ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-white' : 'border-[hsl(var(--border))]'}`}>{step.done && <Check size={12} />}</span><span className={step.done ? 'text-[hsl(var(--muted-foreground))] line-through' : ''}>{step.title}</span></li>)}</ul></div>}
          {task.link && <div><p className="detail-label">Reference link</p><a href={task.link} target="_blank" rel="noreferrer" className="mt-2 block break-all text-sm font-medium text-[hsl(var(--primary))] hover:underline">{task.link}</a></div>}
          {task.attachments.length > 0 && <div><p className="detail-label">Photos & files</p>{photos.length > 0 && <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">{photos.map((file) => <button type="button" key={file.id} aria-label={`Open full-screen photo: ${file.name}`} onClick={(event) => { photoTriggerRef.current = event.currentTarget; setFullScreenPhoto(file.downloadUrl); }} className="group relative aspect-square overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]" data-testid={`button-preview-photo-${file.id}`}><img src={file.downloadUrl} alt="" className="size-full object-cover transition-transform group-hover:scale-105" /><span className="absolute bottom-2 right-2 rounded-full bg-black/60 p-1.5 text-white"><Maximize2 size={13} /></span></button>)}</div>}{files.length > 0 && <ul className="mt-3 space-y-2">{files.map((file) => <li key={file.id}><a href={file.downloadUrl} target="_blank" rel="noreferrer" className="flex min-h-11 items-center gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm text-[hsl(var(--primary))] hover:underline"><Paperclip size={14} />{file.name}<span className="ml-auto text-xs text-[hsl(var(--muted-foreground))]">Open file</span></a></li>)}</ul>}</div>}
          {task.attachments.length === 0 && <p className="text-sm text-[hsl(var(--muted-foreground))]">No photos or files attached.</p>}
        </div>
        </Dialog.Content>
      </Dialog.Portal>
      <Dialog.Root open={Boolean(fullScreenPhoto)} onOpenChange={(open) => { if (!open) setFullScreenPhoto(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/90" />
          <Dialog.Content className="fixed inset-0 z-[60] flex items-center justify-center p-5 outline-none" onPointerDownOutside={(event) => event.preventDefault()} onCloseAutoFocus={(event) => { event.preventDefault(); photoTriggerRef.current?.focus(); }}>
            <Dialog.Title className="sr-only">Full-screen task photo</Dialog.Title>
            <Dialog.Description className="sr-only">Expanded view of the selected task attachment.</Dialog.Description>
            {fullScreenPhoto ? <img src={fullScreenPhoto} alt="Full-screen task attachment" className="max-h-full max-w-full object-contain" /> : null}
            <Dialog.Close asChild><button type="button" aria-label="Close full-screen photo" className="absolute right-5 top-5 flex size-11 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"><X size={22} /></button></Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </Dialog.Root>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><p className="detail-label">{label}</p><p className="mt-1 text-sm text-[hsl(var(--foreground))]">{value}</p></div>;
}

export function LinkOut({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer" data-testid="link-task-reference" className="inline-flex items-center gap-1 font-medium text-[hsl(var(--primary))] hover:underline">{children}<ExternalLink size={12} /></a>;
}

export function FormField({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="block"><span className="mb-2 block font-mono text-[10px] uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">{label}</span>{children}{hint && <span className="mt-1.5 block text-[11px] text-[hsl(var(--muted-foreground))]">{hint}</span>}</label>;
}
