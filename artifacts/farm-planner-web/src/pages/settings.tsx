import { useEffect, useRef, useState, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { BookOpen, Check, ExternalLink, FileSpreadsheet, GripVertical, Plus, RefreshCw, Settings2, Smartphone, SunMedium, CalendarSync, Trash2 } from 'lucide-react';
import { getGetFarmSettingsQueryKey, getGetOrchardCalendarSyncStatusQueryKey, getListFarmTasksQueryKey, useListFarmTasks, useGetOrchardCalendarSyncStatus, useSyncOrchardCalendar, useGetFarmSettings, useUpdateFarmSettings, type FarmSettings } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { ErrorState, PageHeader, PlannerShell, SourcePill, SyncNotice } from '@/components/farm-planner';
import { resolveDefaultLocation } from '@/lib/farm-settings-options';
import { isSafeExternalUrl } from '@/lib/task-map-links';

const PREF_KEY = 'fieldbook-preferences';

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState('');
  const [compactCards, setCompactCards] = useState(false);
  const [showCompleted, setShowCompleted] = useState(true);
  const [member, setMember] = useState<{ role: string; isManager?: boolean; isHarnold?: boolean } | null>(null);
  const [workers, setWorkers] = useState<Array<{ clerkId: string; email: string; displayName: string; status: string; role: string }>>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<'manager' | 'worker'>('worker');
  const [teamMessage, setTeamMessage] = useState('');
  const [inviteSending, setInviteSending] = useState(false);
  const [workerNameDrafts, setWorkerNameDrafts] = useState<Record<string, string>>({});
  const [savingWorkerId, setSavingWorkerId] = useState('');
  const [resendingWorkerId, setResendingWorkerId] = useState('');
  const [revokingWorkerId, setRevokingWorkerId] = useState('');
  const [calendarMessage, setCalendarMessage] = useState('');
  const [groups, setGroups] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [newGroup, setNewGroup] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [defaultGroup, setDefaultGroup] = useState('');
  const [defaultUrgency, setDefaultUrgency] = useState<'Urgent' | 'High' | 'Medium' | 'Low'>('Medium');
  const [defaultLocation, setDefaultLocation] = useState('');
  const [farmSettingsMessage, setFarmSettingsMessage] = useState('');
  const sourceQuery = useListFarmTasks({ includeDone: true }, { query: { queryKey: getListFarmTasksQueryKey({ includeDone: true }), enabled: member?.isManager === true } });
  const calendarQuery = useGetOrchardCalendarSyncStatus({ query: { queryKey: getGetOrchardCalendarSyncStatusQueryKey(), enabled: member?.isManager === true } });
  const calendarSync = useSyncOrchardCalendar({
    mutation: {
      onSuccess: (result) => {
        setCalendarMessage(result.errors
          ? `Import finished with ${result.errors} error${result.errors === 1 ? '' : 's'}. Review the calendar rows below.`
          : `Import finished: ${result.created} new, ${result.updated} updated, ${result.skipped} unchanged.`);
        void calendarQuery.refetch();
        void queryClient.invalidateQueries({ queryKey: getListFarmTasksQueryKey({ includeDone: true }) });
      },
      onError: (error) => {
        const detail = (error as { data?: { error?: unknown } } | null)?.data?.error;
        setCalendarMessage(typeof detail === 'string' ? detail : 'Calendar import failed. Check the connected account and try again.');
      },
    },
  });
  const calendarRateLimited = calendarQuery.data?.lastError?.toLowerCase().includes('temporarily rate-limited')
    || calendarQuery.data?.result?.calendars.some((calendar) => calendar.error?.toLowerCase().includes('temporarily rate-limited'));
  const farmSettingsQuery = useGetFarmSettings({ query: { queryKey: ['/api/farm-settings'], enabled: member?.isManager === true } });
  const applyFarmSettings = (settings: FarmSettings) => {
    setGroups(settings.groups);
    setLocations(settings.locations);
    setDefaultGroup(settings.groups.includes(settings.defaultGroup) ? settings.defaultGroup : settings.groups[0] ?? '');
    setDefaultUrgency(settings.defaultUrgency);
    setDefaultLocation(settings.locations.includes(settings.defaultLocation) ? settings.defaultLocation : settings.locations[0] ?? '');
  };
  const saveFarmSettings = useUpdateFarmSettings({
    mutation: {
      onSuccess: (settings) => {
        applyFarmSettings(settings);
        queryClient.setQueryData(getGetFarmSettingsQueryKey(), settings);
        setFarmSettingsMessage('Shared task options saved.');
      },
      onError: (error) => {
        const detail = (error as { data?: { error?: unknown } } | null)?.data?.error;
        setFarmSettingsMessage(typeof detail === 'string' ? detail : 'Could not save shared task options.');
      },
    },
  });
  const refreshTeam = () => void fetch('/api/me').then((response) => response.ok ? response.json() : null).then((value) => {
    if (!value) return;
    setMember(value);
     if (value.isManager) void farmSettingsQuery.refetch();
     if (value.isManager) void fetch('/api/team').then((response) => response.ok ? response.json() : []).then((next) => {
       setWorkers(next);
       setWorkerNameDrafts(Object.fromEntries(next.map((worker: { clerkId: string; displayName: string }) => [worker.clerkId, worker.displayName])));
     });
  });
  useEffect(() => { refreshTeam(); }, []);
  useEffect(() => {
    const settings = farmSettingsQuery.data;
    if (!settings) return;
    applyFarmSettings(settings);
  }, [farmSettingsQuery.data]);
  const addGroup = () => {
    const value = newGroup.trim();
    if (!value) return setFarmSettingsMessage('Enter a group name before adding it.');
    if (groups.some((group) => group.toLocaleLowerCase() === value.toLocaleLowerCase())) return setFarmSettingsMessage('That work group is already listed.');
    setGroups((current) => [...current, value]);
    if (!defaultGroup) setDefaultGroup(value);
    setNewGroup('');
    setFarmSettingsMessage('');
  };
  const addLocation = () => {
    const value = newLocation.trim();
    if (!value) return setFarmSettingsMessage('Enter a location name before adding it.');
    if (locations.some((location) => location.toLocaleLowerCase() === value.toLocaleLowerCase())) return setFarmSettingsMessage('That location is already listed.');
    setLocations((current) => [...current, value]);
    if (!defaultLocation) setDefaultLocation(value);
    setNewLocation('');
    setFarmSettingsMessage('');
  };
  const removeGroup = (index: number) => {
    if (groups.length === 1) return setFarmSettingsMessage('Keep at least one work group.');
    const next = groups.filter((_, itemIndex) => itemIndex !== index);
    setGroups(next);
    setDefaultGroup((current) => next.includes(current) ? current : next[0] ?? '');
    setFarmSettingsMessage('');
  };
  const removeLocation = (index: number) => {
    const next = locations.filter((_, itemIndex) => itemIndex !== index);
    setLocations(next);
    setDefaultLocation((current) => next.includes(current) ? current : next[0] ?? '');
    setFarmSettingsMessage('');
  };
  const saveSharedOptions = () => {
    const nextGroups = Array.from(new Set(groups.map((item) => item.trim()).filter(Boolean)));
    const nextLocations = Array.from(new Set(locations.map((item) => item.trim()).filter(Boolean)));
    if (!nextGroups.length) {
      setFarmSettingsMessage('Keep at least one work group.');
      return;
    }
    const nextDefaultGroup = nextGroups.includes(defaultGroup.trim()) ? defaultGroup.trim() : nextGroups[0]!;
    const nextDefaultLocation = resolveDefaultLocation(nextLocations, defaultLocation);
    setGroups(nextGroups);
    setLocations(nextLocations);
    setDefaultGroup(nextDefaultGroup);
    setDefaultLocation(nextDefaultLocation);
    saveFarmSettings.mutate({ data: { groups: nextGroups, locations: nextLocations, defaultGroup: nextDefaultGroup, defaultUrgency, defaultLocation: nextDefaultLocation } });
  };
  const inviteWorker = async () => {
    setInviteSending(true);
    try {
      const response = await fetch('/api/team/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: inviteEmail, displayName: inviteName, role: inviteRole }) });
      const result = await response.json().catch(() => ({})) as { error?: string; invitationSent?: boolean };
      setTeamMessage(response.ok && result.invitationSent
        ? `Invitation sent to ${inviteEmail.trim()}. They can use the link in that email to create their account.`
        : (result.error ?? 'Could not send that invitation.'));
      if (response.ok) { setInviteEmail(''); setInviteName(''); setInviteRole('worker'); refreshTeam(); }
    } catch {
      setTeamMessage('Could not send that invitation. Check your connection and try again.');
    } finally {
      setInviteSending(false);
    }
  };
  const resendInvitation = async (worker: { clerkId: string; email: string }) => {
    setResendingWorkerId(worker.clerkId);
    try {
      const response = await fetch(`/api/team/${encodeURIComponent(worker.clerkId)}/resend`, { method: 'POST' });
      const result = await response.json().catch(() => ({})) as { error?: string; invitationSent?: boolean };
      setTeamMessage(response.ok && result.invitationSent
        ? `Invitation delivery succeeded for ${worker.email}. A fresh sign-up link was sent.`
        : (result.error ?? 'Could not resend that invitation.'));
    } catch {
      setTeamMessage('Could not resend that invitation. Check your connection and try again.');
    } finally {
      setResendingWorkerId('');
    }
  };
  const revokeInvitation = async (worker: { clerkId: string; email: string }) => {
    if (!window.confirm(`Revoke the invitation for ${worker.email}? This keeps the worker record for your audit history but prevents the invitation from joining the farm.`)) return;
    setRevokingWorkerId(worker.clerkId);
    try {
      const response = await fetch(`/api/team/${encodeURIComponent(worker.clerkId)}/revoke`, { method: 'POST' });
      const result = await response.json().catch(() => ({})) as { error?: string; warning?: string; member?: { status?: string } };
      setTeamMessage(response.ok && result.member?.status === 'revoked'
        ? (result.warning ?? `Invitation revoked for ${worker.email}. The pending link can no longer be used to join the farm.`)
        : (result.error ?? 'Could not revoke that invitation.'));
      if (response.ok) refreshTeam();
    } catch {
      setTeamMessage('Could not revoke that invitation. Check your connection and try again.');
    } finally {
      setRevokingWorkerId('');
    }
  };
  const saveWorkerName = async (worker: { clerkId: string }) => {
    setSavingWorkerId(worker.clerkId);
    try {
      const response = await fetch(`/api/team/${encodeURIComponent(worker.clerkId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: workerNameDrafts[worker.clerkId]?.trim() }),
      });
      setTeamMessage(response.ok ? 'Worker display name saved.' : ((await response.json().catch(() => ({})) as { error?: string }).error ?? 'Could not save worker display name.'));
      if (response.ok) refreshTeam();
    } catch {
      setTeamMessage('Could not save worker display name. Check your connection and try again.');
    } finally {
      setSavingWorkerId('');
    }
  };

  useEffect(() => {
    try {
      const preferences = JSON.parse(localStorage.getItem(PREF_KEY) || '{}') as { compactCards?: boolean; showCompleted?: boolean };
      if (typeof preferences.compactCards === 'boolean') setCompactCards(preferences.compactCards);
      if (typeof preferences.showCompleted === 'boolean') setShowCompleted(preferences.showCompleted);
    } catch {
      // Keep the sensible defaults when local preferences are unavailable.
    }
  }, []);

  const savePreferences = (next: { compactCards?: boolean; showCompleted?: boolean }) => {
    const preferences = { compactCards, showCompleted, ...next };
    setCompactCards(preferences.compactCards);
    setShowCompleted(preferences.showCompleted);
    localStorage.setItem(PREF_KEY, JSON.stringify(preferences));
    setSaved('Preferences saved on this device.');
    window.setTimeout(() => setSaved(''), 2800);
  };

  return (
      <PlannerShell loadSourceQuery={member?.isManager === true}>
      <div className="page-enter mx-auto max-w-[1180px] px-5 py-7 md:px-10 md:py-12 xl:px-14">
        <PageHeader eyebrow="The way we work" title="Settings." description="A few practical choices for the fieldbook. The shared work itself lives in one place: the connected Google Sheet." />
        {member && !member.isManager && <div className="mb-6 rounded-xl border border-[hsl(35_82%_66%/.55)] bg-[hsl(35_82%_66%/.12)] px-4 py-3 text-sm text-[hsl(var(--foreground))]" role="alert">Shared farm settings, Google Sheets, and agenda sync are managed by a farm manager. You can still create and update your assigned work from the planner.</div>}
        {saved && <div className="mb-6 flex items-center gap-2 rounded-xl border border-[hsl(76_28%_67%/.48)] bg-[hsl(76_35%_92%/.7)] px-4 py-3 text-xs font-medium text-[hsl(155_28%_29%)]" role="status" data-testid="status-settings-saved"><Check size={15} />{saved}</div>}
        {member?.isManager && <section className="mb-6 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 md:p-7" data-testid="panel-team">
          <div className="flex items-start justify-between gap-4"><div><p className="font-mono text-[10px] uppercase tracking-[.15em] text-[hsl(var(--primary))]">Farm team</p><h2 className="mt-2 font-serif text-3xl text-[hsl(var(--foreground))]">Workers & access</h2><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Send a sign-up link. When the invited email signs in, access is linked automatically.</p></div></div>
           <div className="mt-5 grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]"><input value={inviteName} onChange={(event) => setInviteName(event.target.value)} placeholder="Display name" className="field-input" data-testid="input-worker-name" /><input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="worker@example.com" className="field-input" data-testid="input-worker-email" /><label className="text-xs font-semibold"><span className="sr-only">Access level</span><select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as 'manager' | 'worker')} className="field-input" data-testid="select-invite-role"><option value="worker">Worker — assigned tasks</option><option value="manager">Manager — full owner access</option></select></label><button type="button" onClick={inviteWorker} disabled={inviteSending} className="rounded-xl bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-semibold text-[hsl(var(--primary-foreground))] disabled:cursor-not-allowed disabled:opacity-60" data-testid="button-invite-worker">{inviteSending ? 'Sending…' : 'Invite member'}</button></div>
          {teamMessage && <p className="mt-3 text-xs leading-5 text-[hsl(var(--muted-foreground))]" role="status" data-testid="text-team-message">{teamMessage}</p>}
             <div className="mt-6 divide-y divide-[hsl(var(--border))]">{workers.filter((worker) => worker.role !== 'master' && worker.role !== 'manager').map((worker) => <div key={worker.clerkId} className="flex flex-wrap items-center justify-between gap-3 py-3"><div className="min-w-[240px] flex-1"><input value={workerNameDrafts[worker.clerkId] ?? worker.displayName} onChange={(event) => setWorkerNameDrafts((current) => ({ ...current, [worker.clerkId]: event.target.value }))} aria-label={`Display name for ${worker.email}`} className="field-input text-sm font-semibold" /><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{worker.email}</p><p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--primary))]">Worker</p>{worker.status === 'invited' && <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">Waiting for this email to sign in</p>}{worker.status === 'revoked' && <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">Invitation revoked · retained for audit history</p>}</div><div className="flex items-center gap-3"><span className={`rounded-full px-3 py-1 font-mono text-[10px] uppercase ${worker.status === 'revoked' ? 'bg-[hsl(5_61%_49%/.1)] text-[hsl(5_61%_42%)]' : 'bg-[hsl(var(--muted))]'}`}>{worker.status}</span>{worker.status === 'active' && <button type="button" onClick={() => void saveWorkerName(worker)} disabled={savingWorkerId === worker.clerkId} className="text-xs font-semibold text-[hsl(var(--primary))] disabled:opacity-60">{savingWorkerId === worker.clerkId ? 'Saving…' : 'Save name'}</button>}{worker.status === 'invited' && <><button type="button" onClick={() => void resendInvitation(worker)} disabled={resendingWorkerId === worker.clerkId || revokingWorkerId === worker.clerkId} className="text-xs font-semibold text-[hsl(var(--primary))] disabled:cursor-not-allowed disabled:opacity-60" data-testid={`button-resend-worker-${worker.clerkId}`}>{resendingWorkerId === worker.clerkId ? 'Sending…' : 'Resend'}</button><button type="button" onClick={() => void revokeInvitation(worker)} disabled={resendingWorkerId === worker.clerkId || revokingWorkerId === worker.clerkId} className="text-xs font-semibold text-[hsl(5_61%_42%)] disabled:cursor-not-allowed disabled:opacity-60" data-testid={`button-revoke-worker-${worker.clerkId}`}>{revokingWorkerId === worker.clerkId ? 'Revoking…' : 'Revoke'}</button></>}</div></div>)}{workers.filter((worker) => worker.role === 'manager').map((worker) => <div key={worker.clerkId} className="flex flex-wrap items-center justify-between gap-3 py-3"><div className="min-w-[240px] flex-1"><input value={workerNameDrafts[worker.clerkId] ?? worker.displayName} onChange={(event) => setWorkerNameDrafts((current) => ({ ...current, [worker.clerkId]: worker.displayName }))} aria-label={`Display name for ${worker.email}`} className="field-input text-sm font-semibold" readOnly /><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{worker.email}</p><p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--primary))]">Manager</p>{worker.status === 'invited' && <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">Waiting for this email to sign in</p>}</div><div className="flex items-center gap-3"><span className={`rounded-full px-3 py-1 font-mono text-[10px] uppercase ${worker.status === 'revoked' ? 'bg-[hsl(5_61%_49%/.1)] text-[hsl(5_61%_42%)]' : 'bg-[hsl(var(--muted))]'}`}>{worker.status}</span>{worker.status === 'invited' && <><button type="button" onClick={() => void resendInvitation(worker)} disabled={resendingWorkerId === worker.clerkId || revokingWorkerId === worker.clerkId} className="text-xs font-semibold text-[hsl(var(--primary))] disabled:cursor-not-allowed disabled:opacity-60" data-testid={`button-resend-worker-${worker.clerkId}`}>{resendingWorkerId === worker.clerkId ? 'Sending…' : 'Resend'}</button><button type="button" onClick={() => void revokeInvitation(worker)} disabled={resendingWorkerId === worker.clerkId || revokingWorkerId === worker.clerkId} className="text-xs font-semibold text-[hsl(5_61%_42%)] disabled:cursor-not-allowed disabled:opacity-60" data-testid={`button-revoke-worker-${worker.clerkId}`}>{revokingWorkerId === worker.clerkId ? 'Revoking…' : 'Revoke'}</button></>}</div></div>)}</div>
        </section>}
          {member?.isManager && <section className="mb-6 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 md:p-7" data-testid="panel-farm-settings">
           <div><p className="font-mono text-[10px] uppercase tracking-[.15em] text-[hsl(var(--primary))]">Shared task options</p><h2 className="mt-2 font-serif text-3xl text-[hsl(var(--foreground))]">Farm defaults</h2><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">These groups, locations, and defaults are used by every planner and phone.</p></div>
            <div className="mt-5 grid gap-5 md:grid-cols-2">
              <OptionListEditor
                label="Work groups"
                singularLabel="group"
                items={groups}
                newValue={newGroup}
                onNewValueChange={setNewGroup}
                onAdd={addGroup}
                onChange={(index, value) => {
                  const previous = groups[index];
                  setGroups((current) => current.map((item, itemIndex) => itemIndex === index ? value : item));
                  if (defaultGroup === previous) setDefaultGroup(value);
                }}
                 onReorder={(fromIndex, toIndex) => setGroups((current) => moveItem(current, fromIndex, toIndex))}
                onRemove={removeGroup}
                preventLastRemoval
              />
              <OptionListEditor
                label="Locations"
                singularLabel="location"
                items={locations}
                newValue={newLocation}
                onNewValueChange={setNewLocation}
                onAdd={addLocation}
                onChange={(index, value) => {
                  const previous = locations[index];
                  setLocations((current) => current.map((item, itemIndex) => itemIndex === index ? value : item));
                  if (defaultLocation === previous) setDefaultLocation(value);
                }}
                 onReorder={(fromIndex, toIndex) => setLocations((current) => moveItem(current, fromIndex, toIndex))}
                onRemove={removeLocation}
              />
              <label className="text-xs font-semibold">Default group<select value={defaultGroup} onChange={(event) => setDefaultGroup(event.target.value)} className="field-input mt-2" data-testid="select-default-group">{groups.map((item) => item.trim()).filter(Boolean).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
              <label className="text-xs font-semibold">Default priority<select value={defaultUrgency} onChange={(event) => setDefaultUrgency(event.target.value as typeof defaultUrgency)} className="field-input mt-2"><option>Urgent</option><option>High</option><option>Medium</option><option>Low</option></select></label>
              <label className="text-xs font-semibold md:col-span-2">Default location<select value={defaultLocation} onChange={(event) => setDefaultLocation(event.target.value)} className="field-input mt-2" data-testid="select-default-location"><option value="">No default location</option>{locations.map((item) => item.trim()).filter(Boolean).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            </div>
           {farmSettingsMessage && <p className="mt-3 text-xs" role="status">{farmSettingsMessage}</p>}
            <button type="button" onClick={saveSharedOptions} disabled={saveFarmSettings.isPending || farmSettingsQuery.isLoading} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-semibold text-[hsl(var(--primary-foreground))] disabled:opacity-50" data-testid="button-save-farm-settings">{saveFarmSettings.isPending ? 'Saving…' : 'Save shared options'}</button>
         </section>}

        <section className="mb-6 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 md:p-7" data-testid="panel-phone-access">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[.14em] text-[hsl(var(--primary))]">Recommended phone setup</p>
              <h2 className="mt-1 font-serif text-2xl text-[hsl(var(--foreground))]">Use the planner like an app</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[hsl(var(--muted-foreground))]">For daily farm work, open this planner in Android Chrome and choose <strong className="font-semibold text-[hsl(var(--foreground))]">Add to Home screen</strong>. The shortcut opens a focused standalone view and keeps the web planner updated without an app-store release.</p>
            </div>
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[hsl(156_28%_28%/.1)] text-[hsl(var(--primary))]"><Smartphone size={22} strokeWidth={1.6} /></div>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.55)] p-4">
              <p className="text-xs font-semibold text-[hsl(var(--foreground))]">Daily use</p>
              <p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Use the home-screen shortcut for tasks, weekly work, and offline fieldbook changes.</p>
            </div>
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.55)] p-4">
              <p className="text-xs font-semibold text-[hsl(var(--foreground))]">Native testing</p>
              <p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Use Expo Go only when testing native camera, GPS, or Android-specific behavior.</p>
            </div>
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.55)] p-4">
              <p className="text-xs font-semibold text-[hsl(var(--foreground))]">No Android app required</p>
              <p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">A standalone Android package can wait unless the web shortcut cannot meet a native requirement.</p>
            </div>
          </div>
        </section>

        {member?.isManager && <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,.8fr)]">
          <div className="space-y-6">
            <section className="overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]" data-testid="panel-google-sheet">
              <div className="flex items-start justify-between gap-4 border-b border-[hsl(var(--border))] bg-[hsl(76_35%_92%/.35)] px-5 py-5 md:px-7">
                <div><div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.15em] text-[hsl(var(--primary))]"><span className="size-2 rounded-full bg-[hsl(76_44%_45%)]" /> Live connection</div><h2 className="mt-3 font-serif text-3xl tracking-[-.03em] text-[hsl(var(--foreground))]">Google Sheets source</h2></div>
                <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[hsl(156_28%_28%/.1)] text-[hsl(var(--primary))]"><FileSpreadsheet size={22} strokeWidth={1.6} /></div>
              </div>
              <div className="space-y-6 px-5 py-6 md:px-7 md:py-7">
                <div className="flex flex-wrap items-center justify-between gap-3"><SourcePill source={sourceQuery.data?.source} /><SyncNotice syncing={sourceQuery.isFetching} message="Changes are read from the shared source" /></div>
                  <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.55)] p-4"><p className="font-mono text-[10px] uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">Current source</p>{isSafeExternalUrl(sourceQuery.data?.sourceUrl) ? <a href={sourceQuery.data.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex max-w-full items-center gap-2 break-words text-sm font-semibold text-[hsl(var(--primary))] underline-offset-4 hover:underline" data-testid="link-google-sheet"><span className="break-words">{sourceQuery.data?.source || 'Connected Google Sheet'}</span><ExternalLink size={14} className="shrink-0" /></a> : <p className="mt-2 text-sm font-semibold text-[hsl(var(--muted-foreground))]" data-testid="text-google-sheet-unavailable">{sourceQuery.isLoading ? 'Reading source information…' : 'Spreadsheet destination unavailable'}</p>}<p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">{isSafeExternalUrl(sourceQuery.data?.sourceUrl) ? 'Opens the shared task spreadsheet in a new tab.' : 'Refresh the connection before trying to open the spreadsheet.'}</p></div>
                {sourceQuery.isError ? <ErrorState onRetry={() => void sourceQuery.refetch()} message="The source details could not be read right now." /> : <div className="grid gap-4 sm:grid-cols-2"><div className="flex gap-3"><div className="mt-0.5 text-[hsl(var(--primary))]"><BookOpen size={17} /></div><div><h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">One shared record</h3><p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">The sheet is the source of truth. Edits here are written back, not kept in a separate app database.</p></div></div><div className="flex gap-3"><div className="mt-0.5 text-[hsl(var(--primary))]"><Smartphone size={17} /></div><div><h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Phone and computer aligned</h3><p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Pick up the same work list at the barn, in the orchard, or back at the desk.</p></div></div></div>}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[hsl(var(--border))] pt-5"><button type="button" onClick={() => void sourceQuery.refetch()} disabled={sourceQuery.isFetching} data-testid="button-refresh-source" className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] px-4 py-2.5 text-xs font-semibold text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-50"><RefreshCw size={14} className={sourceQuery.isFetching ? 'animate-spin' : ''} /> Refresh connection</button><span className="text-[11px] text-[hsl(var(--muted-foreground))]">Connection is managed by your planner setup.</span></div>
              </div>
            </section>
            <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 md:p-7" data-testid="panel-calendar-sync">
              <div className="flex items-start justify-between gap-4">
                <div><p className="font-mono text-[10px] uppercase tracking-[.14em] text-[hsl(var(--muted-foreground))]">Combined one-way calendar import</p><h2 className="mt-1 font-serif text-2xl text-[hsl(var(--foreground))]">Farm & agenda calendars</h2><p className="mt-2 max-w-lg text-xs leading-5 text-[hsl(var(--muted-foreground))]">Events from seven calendar sources become clearly grouped fieldbook tasks. This import is read-only: changes here never alter your calendars.</p></div>
                <CalendarSync size={22} className="shrink-0 text-[hsl(var(--primary))]" />
              </div>
                 <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.55)] p-4">
                 <div><p className="text-xs font-semibold text-[hsl(var(--foreground))]">{calendarQuery.data?.state === 'syncing' ? 'Syncing calendar…' : calendarRateLimited ? 'Calendar temporarily rate-limited' : calendarQuery.data?.state === 'error' ? 'Calendar needs attention' : 'Calendar import ready'}</p><p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">{calendarRateLimited ? 'Google Calendar is temporarily rate-limited; try again shortly.' : calendarQuery.data?.lastError || (calendarQuery.data?.lastSyncAt ? `Last checked ${new Date(calendarQuery.data.lastSyncAt).toLocaleString()}` : 'No completed sync yet.')}</p></div>
                <button type="button" onClick={() => calendarSync.mutate()} disabled={calendarSync.isPending || calendarQuery.data?.state === 'syncing'} data-testid="button-sync-orchard-calendar" className="inline-flex items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-semibold text-[hsl(var(--primary-foreground))] disabled:opacity-50"><RefreshCw size={14} className={calendarSync.isPending ? 'animate-spin' : ''} /> {calendarSync.isPending ? 'Importing…' : 'Sync now'}</button>
              </div>
                 {calendarMessage && <p className="mt-3 rounded-lg bg-[hsl(var(--muted)/.55)] px-3 py-2 text-xs" role="status">{calendarMessage}</p>}
                  {calendarQuery.data?.sources && <div className="mt-4 space-y-2" data-testid="calendar-source-status">
                    {calendarQuery.data.sources.map((source) => {
                      const result = calendarQuery.data?.result?.calendars.find((calendar) => calendar.name === source.name);
                      const href = isSafeExternalUrl(source.url) ? source.url : undefined;
                      return <div key={source.name} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[hsl(var(--border))] px-3 py-2.5 text-xs">
                        <div className="flex min-w-0 items-center gap-2"><span className={`size-2 shrink-0 rounded-full ${source.available ? 'bg-[hsl(76_44%_45%)]' : 'bg-[hsl(0_65%_55%)]'}`} />{href ? <a href={href} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1.5 font-semibold text-[hsl(var(--primary))] hover:underline" data-testid={`link-calendar-source-${source.name.toLowerCase().replaceAll(' ', '-')}`}><span className="truncate">{source.name}</span><ExternalLink size={12} className="shrink-0" /></a> : <span className="font-semibold">{source.name}</span>}</div>
                        <span className="max-w-full text-[hsl(var(--muted-foreground))]">{source.message || result?.error || result?.warning || (result ? `${result.created} new · ${result.updated} updated · ${result.skipped} unchanged` : href ? 'Open agenda' : 'Agenda destination unavailable')}</span>
                      </div>;
                    })}
                 </div>}
                    <p className="mt-4 text-[11px] text-[hsl(var(--muted-foreground))]">Sources: Primary Google Calendar, Orchard Managment, Pasture Management, Yurtsforyou, Wwoofers, Mahakaruna Classroom bookings, and the public Hirshberg Institute calendar. The first import includes events from the start of the current year.</p>
            </section>
            <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 md:p-7" data-testid="panel-preferences">
              <div className="flex items-center gap-3"><div className="flex size-10 items-center justify-center rounded-xl bg-[hsl(35_82%_66%/.2)] text-[hsl(26_55%_35%)]"><Settings2 size={19} /></div><div><p className="font-mono text-[10px] uppercase tracking-[.14em] text-[hsl(var(--muted-foreground))]">On this device</p><h2 className="mt-1 font-serif text-2xl text-[hsl(var(--foreground))]">Planner preferences</h2></div></div>
              <div className="mt-7 divide-y divide-[hsl(var(--border))]">
                 <PreferenceRow icon={<BookOpen size={17} />} label="Show completed work" description="Keep completed tasks available in the task list." checked={showCompleted} onChange={(checked) => savePreferences({ showCompleted: checked })} testId="toggle-show-completed" />
                <PreferenceRow icon={<SunMedium size={17} />} label="Compact task cards" description="Fit more tasks on screen at once." checked={compactCards} onChange={(checked) => savePreferences({ compactCards: checked })} testId="toggle-compact-cards" />
              </div>
            </section>
          </div>
        </div>}
      </div>
    </PlannerShell>
  );
}

function PreferenceRow({ icon, label, description, checked, onChange, testId }: { icon: ReactNode; label: string; description: string; checked: boolean; onChange: (checked: boolean) => void; testId: string }) {
  return <div className="flex items-center justify-between gap-4 py-5"><div className="flex min-w-0 items-start gap-3"><div className="mt-0.5 text-[hsl(var(--primary))]">{icon}</div><div><p className="text-sm font-semibold text-[hsl(var(--foreground))]">{label}</p><p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">{description}</p></div></div><button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} data-testid={testId} className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors ${checked ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]' : 'border-[hsl(var(--border))] bg-[hsl(var(--muted))]'}`}><span className={`absolute top-1 size-5 rounded-full bg-[hsl(var(--card))] shadow-sm transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} /></button></div>;
}

export function moveItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex === toIndex
    || fromIndex < 0
    || toIndex < 0
    || fromIndex >= items.length
    || toIndex >= items.length
  ) return items;
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item!);
  return next;
}

export function OptionListEditor({
  label,
  singularLabel,
  items,
  newValue,
  onNewValueChange,
  onAdd,
  onChange,
  onReorder,
  onRemove,
  preventLastRemoval = false,
}: {
  label: string;
  singularLabel: string;
  items: string[];
  newValue: string;
  onNewValueChange: (value: string) => void;
  onAdd: () => void;
  onChange: (index: number, value: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onRemove: (index: number) => void;
  preventLastRemoval?: boolean;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const finishDrag = (targetIndex: number | null) => {
    if (dragIndex !== null && targetIndex !== null && dragIndex !== targetIndex) {
      onReorder(dragIndex, targetIndex);
    }
    setDragIndex(null);
    setDragOverIndex(null);
  };

  useEffect(() => {
    if (dragIndex === null) return;
    const handlePointerMove = (event: PointerEvent) => {
      if (typeof document.elementFromPoint !== 'function') return;
      const element = document.elementFromPoint(event.clientX, event.clientY);
      const row = element?.closest<HTMLElement>('[data-option-index]');
      if (!row || !listRef.current?.contains(row)) {
        setDragOverIndex(null);
        return;
      }
      setDragOverIndex(Number(row.dataset.optionIndex));
    };
    const handlePointerUp = () => finishDrag(dragOverIndex);
    const handlePointerCancel = () => finishDrag(null);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, [dragIndex, dragOverIndex]);

  const startPointerDrag = (index: number, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary) return;
    event.preventDefault();
    setDragIndex(index);
    setDragOverIndex(index);
  };
  const startNativeDrag = (index: number, event: ReactDragEvent<HTMLButtonElement>) => {
    setDragIndex(index);
    setDragOverIndex(index);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(index));
    }
  };
  const handleNativeDragOver = (index: number, event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    if (dragIndex !== null) setDragOverIndex(index);
  };

  return <fieldset className="min-w-0 rounded-xl border border-[hsl(var(--border))] p-4">
    <legend className="px-1 text-xs font-semibold">{label}</legend>
     <p className="mb-3 text-[11px] leading-5 text-[hsl(var(--muted-foreground))]">Drag the handle to reorder, or use the move buttons.</p>
     <div className="space-y-2" ref={listRef} aria-live="polite">
       {items.length ? items.map((item, index) => <div
         key={`${singularLabel}-${index}`}
         data-option-index={index}
         onDragOver={(event) => handleNativeDragOver(index, event)}
         onDrop={(event) => { event.preventDefault(); finishDrag(index); }}
         className={`flex items-center gap-2 rounded-xl transition-colors ${dragOverIndex === index && dragIndex !== index ? 'bg-[hsl(var(--secondary))]' : ''} ${dragIndex === index ? 'opacity-55' : ''}`}
       >
         <button
           type="button"
           draggable
           onPointerDown={(event) => startPointerDrag(index, event)}
           onDragStart={(event) => startNativeDrag(index, event)}
           onDragEnd={() => finishDrag(null)}
           aria-label={`Drag ${singularLabel} ${item || index + 1}`}
           title="Drag to reorder"
           className="flex size-10 shrink-0 touch-none cursor-grab items-center justify-center rounded-xl border border-dashed border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] active:cursor-grabbing"
           data-testid={`handle-${singularLabel}-${index}`}
         >
           <GripVertical size={16} aria-hidden="true" />
         </button>
        <input value={item} onChange={(event) => onChange(index, event.target.value)} aria-label={`${singularLabel} ${index + 1}`} className="field-input min-w-0 flex-1" data-testid={`input-${singularLabel}-${index}`} />
         <div className="flex shrink-0 items-center gap-1">
           <button type="button" onClick={() => onReorder(index, index - 1)} disabled={index === 0} aria-label={`Move ${item || singularLabel} up`} className="flex size-10 items-center justify-center rounded-xl border border-[hsl(var(--border))] text-sm font-semibold text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] disabled:cursor-not-allowed disabled:opacity-35" data-testid={`button-move-${singularLabel}-${index}-up`}>↑</button>
           <button type="button" onClick={() => onReorder(index, index + 1)} disabled={index === items.length - 1} aria-label={`Move ${item || singularLabel} down`} className="flex size-10 items-center justify-center rounded-xl border border-[hsl(var(--border))] text-sm font-semibold text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] disabled:cursor-not-allowed disabled:opacity-35" data-testid={`button-move-${singularLabel}-${index}-down`}>↓</button>
         </div>
        <button type="button" onClick={() => onRemove(index)} disabled={preventLastRemoval && items.length === 1} aria-label={`Remove ${item || singularLabel}`} className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--destructive)/.45)] hover:bg-[hsl(var(--destructive)/.08)] hover:text-[hsl(var(--destructive))] disabled:cursor-not-allowed disabled:opacity-35" data-testid={`button-remove-${singularLabel}-${index}`}><Trash2 size={15} /></button>
      </div>) : <p className="rounded-lg bg-[hsl(var(--muted)/.55)] px-3 py-2 text-xs text-[hsl(var(--muted-foreground))]">No {label.toLowerCase()} saved.</p>}
    </div>
    <div className="mt-3 flex items-center gap-2">
      <input value={newValue} onChange={(event) => onNewValueChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); onAdd(); } }} placeholder={`Add ${singularLabel}`} aria-label={`New ${singularLabel}`} className="field-input min-w-0 flex-1" data-testid={`input-new-${singularLabel}`} />
      <button type="button" onClick={onAdd} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-[hsl(var(--secondary))] px-3 py-2.5 text-xs font-semibold text-[hsl(var(--primary))] hover:bg-[hsl(var(--accent)/.35)]" data-testid={`button-add-${singularLabel}`}><Plus size={14} /> Add</button>
    </div>
  </fieldset>;
}
