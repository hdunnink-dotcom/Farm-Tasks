import { useState } from 'react';
import { Bot, CalendarDays, Check, Clipboard, ExternalLink, Mail, Pause, Play, RefreshCw, ShieldCheck, Sparkles, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetAssistantSettingsQueryKey,
  getListAssistantApprovalRulesQueryKey,
  getListAssistantProposalsQueryKey,
  getListFarmTasksQueryKey,
  getGetTodaysDailyPlanQueryKey,
  useApproveAssistantProposal,
  useApproveAssistantProposalTask,
  useCreateAssistantTaskRequest,
  useGetAssistantSettings,
  useListAssistantApprovalRules,
  useListAssistantProposals,
  useRejectAssistantProposal,
  useRejectAssistantProposalTask,
  useScanAssistantSources,
  useUpdateAssistantApprovalRule,
  useUpdateAssistantSettings,
  useRefreshDailyPlan,
  type AssistantProposal,
  type AssistantProposalTask,
} from '@workspace/api-client-react';
import { PageHeader, PlannerShell } from '@/components/farm-planner';
import { useMe } from '@/hooks/use-me';

function mutationError(error: unknown, fallback: string): string {
  const detail = (error as { data?: { error?: unknown } } | null)?.data?.error;
  return typeof detail === 'string' && detail.trim() ? detail : fallback;
}

function queryKeys() {
  return [
    getListAssistantProposalsQueryKey(),
    getListAssistantApprovalRulesQueryKey(),
    getGetAssistantSettingsQueryKey(),
    getListFarmTasksQueryKey({ includeDone: true }),
    getListFarmTasksQueryKey({ includeDone: false }),
    getGetTodaysDailyPlanQueryKey(),
  ];
}

export default function AssistantPage() {
  const client = useQueryClient();
  const member = useMe();
  const refreshDailyPlan = useRefreshDailyPlan({ mutation: { onSuccess: () => client.invalidateQueries({ queryKey: getGetTodaysDailyPlanQueryKey() }) } });
  const [message, setMessage] = useState('');
  const [request, setRequest] = useState('');
  const [projectContext, setProjectContext] = useState('');
  const [whatNeedsDoing, setWhatNeedsDoing] = useState('');
  const [forWhom, setForWhom] = useState('');
  const [priority, setPriority] = useState<'Urgent' | 'High' | 'Medium' | 'Low'>('Medium');
  const [dueDateTime, setDueDateTime] = useState('');
  const [location, setLocation] = useState('');
  const [duration, setDuration] = useState('');
  const [recurrence, setRecurrence] = useState('none');
  const [notes, setNotes] = useState('');
  const [photoDataUrl, setPhotoDataUrl] = useState('');
  const [connector, setConnector] = useState<{ endpoint: string; authorizationUrl: string; instructions: string } | null>(null);
  const managerEnabled = member.data?.isManager === true;
  const proposals = useListAssistantProposals({}, { query: { queryKey: getListAssistantProposalsQueryKey(), enabled: managerEnabled } });
  const rules = useListAssistantApprovalRules({ query: { queryKey: getListAssistantApprovalRulesQueryKey(), enabled: managerEnabled } });
  const settings = useGetAssistantSettings({ query: { queryKey: getGetAssistantSettingsQueryKey(), enabled: managerEnabled } });
  const refresh = () => Promise.all(queryKeys().map((queryKey) => client.refetchQueries({ queryKey })));
  const scan = useScanAssistantSources({ mutation: { onSuccess: (result) => { setMessage(`Scanned ${result.scanned} source items. ${result.created} new proposal${result.created === 1 ? '' : 's'} added.`); void refresh(); }, onError: () => setMessage('The assistant could not read Gmail or Calendar right now.') } });
  const approvePlan = useApproveAssistantProposal({ mutation: { onSuccess: () => { setMessage('Approved work has been added to the Google Sheet.'); refreshDailyPlan.mutate(); void refresh(); }, onError: (error) => setMessage(mutationError(error, 'That proposal could not be approved.')) } });
  const rejectPlan = useRejectAssistantProposal({ mutation: { onSuccess: () => { setMessage('Proposal dismissed.'); void refresh(); } } });
  const approveTask = useApproveAssistantProposalTask({ mutation: { onSuccess: () => { setMessage('Task added to the Google Sheet.'); refreshDailyPlan.mutate(); void refresh(); }, onError: (error) => setMessage(mutationError(error, 'That task could not be approved.')) } });
  const rejectTask = useRejectAssistantProposalTask({ mutation: { onSuccess: () => { setMessage('Suggestion dismissed.'); void refresh(); } } });
  const updateRule = useUpdateAssistantApprovalRule({ mutation: { onSuccess: () => { setMessage('Repeat approval rule updated.'); void refresh(); } } });
  const updateSettings = useUpdateAssistantSettings({ mutation: { onSuccess: () => { setMessage('Assistant settings saved.'); void refresh(); } } });
  const createRequest = useCreateAssistantTaskRequest({ mutation: { onSuccess: (result) => { setMessage(result.duplicate ? 'This request was already submitted.' : 'Your draft was sent to a manager for review.'); setRequest(''); setProjectContext(''); setWhatNeedsDoing(''); setForWhom(''); setDueDateTime(''); setLocation(''); setDuration(''); setRecurrence('none'); setNotes(''); setPhotoDataUrl(''); void refresh(); }, onError: () => setMessage('Claude could not draft that task right now. Check the required fields and try again.') } });
  const showConnectorDetails = () => {
    const origin = window.location.origin;
    setConnector({
      endpoint: `${origin}/api/assistant/mcp`,
      authorizationUrl: `${origin}/api/assistant/oauth/authorize`,
      instructions: 'Paste this endpoint into a Claude.ai remote connector. Use Claude’s default OAuth discovery instead of “Own OAuth”; do not enter a client ID or client secret. Claude will open Farm Planner for a one-time owner sign-in and approval, then refreshes access automatically.',
    });
    setMessage('Connection details are ready. Add the MCP URL in Claude.ai to continue.');
  };

  const approveFromNowOn = (proposal: AssistantProposal, task: AssistantProposalTask) => {
    const source = proposal.sources.find((item) => item.sourceId === task.sourceId && item.sourceType === task.sourceType);
    const ruleType = task.sourceType === 'calendar' ? (source?.recurringId ? 'calendar_series' : null) : 'gmail_sender_subject';
    if (!ruleType) { setMessage('One-off calendar events always require individual approval.'); return; }
    const scope = task.sourceType === 'calendar'
      ? 'future instances in this recurring calendar series'
      : 'future matching suggestions from the same email sender and subject';
    if (!window.confirm(`Approve this task and automatically approve high-confidence, matching suggestions from ${scope}? You can pause or revoke the rule below.`)) return;
    approveTask.mutate({ proposalId: proposal.id, taskId: task.id, data: { createRule: true, ruleType, ruleName: `Auto-approve: ${task.title}` } });
  };
  const [editingTask, setEditingTask] = useState<{ proposalId: number; task: AssistantProposalTask } | null>(null);

  const handleEditAndApproveSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingTask) return;
    const form = new FormData(e.currentTarget);
    const title = form.get('title') as string;
    const groupName = form.get('groupName') as string;
    const dueDate = form.get('dueDate') as string;
    const notes = form.get('notes') as string;

    if (!title.trim() || !groupName.trim()) return;
    const parsedDueDate = dueDate.trim() ? new Date(`${dueDate.trim()}T00:00:00.000Z`) : null;
    if (parsedDueDate && Number.isNaN(parsedDueDate.getTime())) { setMessage('Use a valid YYYY-MM-DD due date.'); return; }

    approveTask.mutate({ proposalId: editingTask.proposalId, taskId: editingTask.task.id, data: { title: title.trim(), groupName: groupName.trim() as AssistantProposalTask['groupName'], dueDate: dueDate.trim() || null, notes } });
    setEditingTask(null);
  };
  const editRule = (rule: { id: number; name: string; expiresAt?: string | null }) => {
    const name = window.prompt('Rule name', rule.name);
    if (name === null || !name.trim()) return;
    const existingDate = rule.expiresAt ? new Date(rule.expiresAt).toISOString().slice(0, 10) : '';
    const expiry = window.prompt('Optional expiry (YYYY-MM-DD, or leave blank)', existingDate);
    if (expiry === null) return;
    const expiresAt = expiry.trim() ? new Date(`${expiry.trim()}T00:00:00.000Z`) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) { setMessage('Use a valid YYYY-MM-DD expiry date.'); return; }
    updateRule.mutate({ ruleId: rule.id, data: { name: name.trim(), expiresAt: expiry.trim() || null } });
  };

  const saveSettings = () => {
    const playbook = (document.getElementById('assistant-playbook') as HTMLTextAreaElement | null)?.value;
    const lookaheadDays = Number((document.getElementById('assistant-lookahead') as HTMLSelectElement | null)?.value ?? settings.data?.lookaheadDays ?? 45);
    updateSettings.mutate({ data: { enabled: settings.data?.enabled, lookaheadDays, playbook } });
  };

  const isWorker = member.data?.role === 'worker';
  return <PlannerShell loadSourceQuery={managerEnabled}>
    <div className="page-enter mx-auto max-w-[1180px] px-5 py-7 md:px-10 md:py-12 xl:px-14">
      <PageHeader eyebrow="Supervised planning" title="Claude task inbox." description="Claude reads selected Gmail and Calendar items, then proposes practical preparation work. Nothing reaches the fieldbook without your approval—unless you make a specific repeat rule." />
      {message && <div role="status" className="mb-6 flex items-center gap-2 rounded-xl border border-[hsl(76_28%_67%/.48)] bg-[hsl(76_35%_92%/.7)] px-4 py-3 text-xs font-medium text-[hsl(155_28%_29%)]"><Check size={15} />{message}</div>}
      <section className="mb-6 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 md:p-7" data-testid="panel-ask-claude">
        <div className="flex flex-wrap items-start justify-between gap-4">
           <div className="flex items-start gap-3"><div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[hsl(155_28%_28%/.1)] text-[hsl(var(--primary))]"><Bot size={21} /></div><div><p className="font-mono text-[10px] uppercase tracking-[.14em] text-[hsl(var(--primary))]">{isWorker ? 'Worker task draft' : 'Manager task authoring'}</p><h2 className="mt-1 font-serif text-3xl">Ask Claude for a farm task</h2><p className="mt-2 max-w-2xl text-xs leading-5 text-[hsl(var(--muted-foreground))]">{isWorker ? 'Give Claude the required work details. It will prepare a draft for a manager to review; it cannot publish or sync anything.' : 'Describe the work in plain language. Claude uses your playbook and existing task context, then places a clearly labelled draft here for approval.'}</p></div></div>
           {!isWorker && <button type="button" onClick={showConnectorDetails} className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-xs font-semibold"><ExternalLink size={14} />Show Claude connection details</button>}
        </div>
         <form className="mt-5 space-y-3" onSubmit={(event) => { event.preventDefault(); if (isWorker && (!whatNeedsDoing.trim() || !forWhom.trim() || !dueDateTime.trim())) { setMessage('Workers must provide what needs doing, who it is for, priority, and a due date or time.'); return; } if (!isWorker && request.trim().length < 3) { setMessage('Describe the farm task in at least three characters.'); return; } const structuredRequest = isWorker ? `What needs doing: ${whatNeedsDoing.trim()}\nFor: ${forWhom.trim()}\nPriority: ${priority}\nDue: ${dueDateTime.trim()}${location.trim() ? `\nLocation/group: ${location.trim()}` : ''}${duration.trim() ? `\nDuration: ${duration.trim()}` : ''}${recurrence !== 'none' ? `\nRecurrence: ${recurrence}` : ''}${notes.trim() ? `\nNotes and safety context: ${notes.trim()}` : ''}` : request.trim(); createRequest.mutate({ data: { request: structuredRequest, whatNeedsDoing: isWorker ? whatNeedsDoing.trim() : undefined, forWhom: isWorker ? forWhom.trim() : undefined, priority: isWorker ? priority : undefined, dueDateTime: isWorker ? dueDateTime.trim() : undefined, location: location.trim() || undefined, duration: duration.trim() || undefined, recurrence: recurrence as 'none' | 'weekly' | 'biweekly' | 'every4weeks' | 'monthly' | 'quarterly' | 'yearly', notes: notes.trim() || undefined, photoDataUrl: photoDataUrl || undefined, claudeProjectContext: projectContext.trim() || undefined, requestId: `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` } }); }}>
           {isWorker ? <div className="grid gap-3 md:grid-cols-2">
             <label className="block text-xs font-semibold md:col-span-2">What needs doing?<textarea value={whatNeedsDoing} onChange={(event) => setWhatNeedsDoing(event.target.value)} rows={3} maxLength={1000} className="field-input mt-2 w-full resize-y text-sm leading-5" disabled={createRequest.isPending} required /></label>
             <label className="block text-xs font-semibold">Who is it for?<input value={forWhom} onChange={(event) => setForWhom(event.target.value)} maxLength={160} placeholder="Person, team, crop, animal, or equipment" className="field-input mt-2 w-full" disabled={createRequest.isPending} required /></label>
             <label className="block text-xs font-semibold">Priority<select value={priority} onChange={(event) => setPriority(event.target.value as typeof priority)} className="field-input mt-2 w-full" disabled={createRequest.isPending}><option>Urgent</option><option>High</option><option>Medium</option><option>Low</option></select></label>
             <label className="block text-xs font-semibold">Due date or time<input type="datetime-local" value={dueDateTime} onChange={(event) => setDueDateTime(event.target.value)} className="field-input mt-2 w-full" disabled={createRequest.isPending} required /></label>
             <label className="block text-xs font-semibold">Location or group<input value={location} onChange={(event) => setLocation(event.target.value)} maxLength={160} placeholder="Orchard block, workshop, pasture…" className="field-input mt-2 w-full" disabled={createRequest.isPending} /></label>
             <label className="block text-xs font-semibold">Duration<input value={duration} onChange={(event) => setDuration(event.target.value)} maxLength={80} placeholder="e.g. 45 minutes" className="field-input mt-2 w-full" disabled={createRequest.isPending} /></label>
             <label className="block text-xs font-semibold">Repeat<select value={recurrence} onChange={(event) => setRecurrence(event.target.value)} className="field-input mt-2 w-full" disabled={createRequest.isPending}><option value="none">No repeat</option><option value="weekly">Weekly</option><option value="biweekly">Every 2 weeks</option><option value="every4weeks">Every 4 weeks</option><option value="monthly">Monthly</option><option value="quarterly">Every 3 months</option><option value="yearly">Yearly</option></select></label>
             <label className="block text-xs font-semibold md:col-span-2">Notes or safety context<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} maxLength={2000} placeholder="Hazards, tools, access notes, or anything the manager should know." className="field-input mt-2 w-full resize-y text-sm leading-5" disabled={createRequest.isPending} /></label>
             <label className="block text-xs font-semibold md:col-span-2">Optional photo<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="field-input mt-2 w-full text-xs" disabled={createRequest.isPending} onChange={(event) => { const file = event.target.files?.[0]; if (!file) { setPhotoDataUrl(''); return; } if (file.size > 5 * 1024 * 1024) { setMessage('Choose a photo smaller than 5 MB.'); event.currentTarget.value = ''; setPhotoDataUrl(''); return; } const reader = new FileReader(); reader.onload = () => setPhotoDataUrl(typeof reader.result === 'string' ? reader.result : ''); reader.readAsDataURL(file); }} /></label>
           </div> : <label className="block text-xs font-semibold">What should Claude draft?<textarea value={request} onChange={(event) => setRequest(event.target.value)} rows={3} maxLength={2000} placeholder="Make a note to fertilize the orchard with the tow and Fert, and include the mixing ratio of ingredients needed." className="field-input mt-2 w-full resize-y text-sm leading-5" disabled={createRequest.isPending} /></label>}
           {!isWorker && <label className="block text-xs font-semibold">Optional Claude Project context<textarea value={projectContext} onChange={(event) => setProjectContext(event.target.value)} rows={2} maxLength={8000} placeholder="Paste only the relevant Project facts Claude should pass to the planner." className="field-input mt-2 w-full resize-y text-xs leading-5" disabled={createRequest.isPending} /></label>}
           <div className="flex flex-wrap items-center gap-3"><button type="submit" disabled={createRequest.isPending || (isWorker ? !whatNeedsDoing.trim() || !forWhom.trim() || !dueDateTime.trim() : !request.trim())} className="rounded-xl bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-semibold text-[hsl(var(--primary-foreground))] disabled:cursor-not-allowed disabled:opacity-50">{createRequest.isPending ? 'Asking Claude…' : 'Draft task for approval'}</button>{createRequest.isPending && <button type="button" onClick={() => createRequest.reset()} className="rounded-xl border border-[hsl(var(--border))] px-3 py-2.5 text-xs font-semibold">Cancel</button>}<span className="text-[11px] text-[hsl(var(--muted-foreground))]">Never writes to Google Sheets until a manager approves.</span></div>
        </form>
        {connector && <div className="mt-5 rounded-xl border border-[hsl(42_74%_64%/.5)] bg-[hsl(42_74%_64%/.1)] p-4 text-xs"><p className="font-semibold">Claude.ai custom connector details</p><p className="mt-2 leading-5 text-[hsl(var(--muted-foreground))]">{connector.instructions}</p><div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]"><code className="overflow-x-auto rounded-lg bg-[hsl(var(--background))] p-2 text-[11px]">{connector.endpoint}</code><button type="button" onClick={() => void navigator.clipboard?.writeText(connector.endpoint)} className="inline-flex items-center justify-center gap-2 rounded-lg border border-[hsl(var(--border))] px-3 py-2 font-semibold"><Clipboard size={13} />Copy URL</button></div><ol className="mt-3 list-decimal space-y-1 pl-4 leading-5 text-[hsl(var(--muted-foreground))]"><li>In Claude, create a remote MCP connector and paste the URL above.</li><li>Choose Claude’s default OAuth discovery—do not choose <strong>Own OAuth</strong> or enter a client ID or secret.</li><li>When Claude opens Farm Planner, sign in as the farm owner. You will return to Claude automatically.</li></ol><p className="mt-2 text-[10px] leading-4 text-[hsl(var(--muted-foreground))]">No token needs to be copied. The task_request tool can only create a pending proposal; it cannot write directly to Google Sheets.</p></div>}
      </section>
       {managerEnabled && <><section className="mb-6 overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]" data-testid="panel-assistant-scan">
        <div className="flex flex-wrap items-center justify-between gap-5 px-5 py-5 md:px-7">
          <div className="flex items-start gap-3"><div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[hsl(155_28%_28%/.1)] text-[hsl(var(--primary))]"><Sparkles size={21} /></div><div><p className="text-sm font-semibold">Read-only source scan</p><p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Gmail and Google Calendar are only read. Claude cannot send mail or change calendar events.</p></div></div>
          <button type="button" onClick={() => scan.mutate()} disabled={scan.isPending || settings.data?.enabled === false} data-testid="button-scan-assistant" className="inline-flex items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-semibold text-[hsl(var(--primary-foreground))] disabled:cursor-not-allowed disabled:opacity-50"><RefreshCw size={14} className={scan.isPending ? 'animate-spin' : ''} />{scan.isPending ? 'Scanning…' : 'Scan now'}</button>
        </div>
        {settings.data?.lastScanAt && <div className="border-t border-[hsl(var(--border))] bg-[hsl(var(--muted)/.35)] px-5 py-3 text-[11px] text-[hsl(var(--muted-foreground))]">Last scan: {new Date(settings.data.lastScanAt).toLocaleString()}{settings.data.lastError ? ` · ${settings.data.lastError}` : ''}</div>}
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(310px,.65fr)]">
        <main className="space-y-5">
          <div className="flex items-end justify-between gap-4"><div><p className="font-mono text-[10px] uppercase tracking-[.14em] text-[hsl(var(--primary))]">Approval required</p><h2 className="mt-1 font-serif text-3xl">Suggested preparation</h2></div><span className="rounded-full bg-[hsl(var(--muted))] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[.1em]">{proposals.data?.flatMap((proposal) => proposal.tasks).filter((task) => task.status === 'pending').length ?? 0} pending</span></div>
          {proposals.isLoading && <div className="rounded-2xl border border-[hsl(var(--border))] p-6 text-sm text-[hsl(var(--muted-foreground))]">Loading the approval inbox…</div>}
          {!proposals.isLoading && !proposals.data?.length && <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card))] p-8 text-center"><Bot className="mx-auto text-[hsl(var(--primary))]" size={28} /><h3 className="mt-4 font-serif text-2xl">No suggestions waiting</h3><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[hsl(var(--muted-foreground))]">Run a scan when you want Claude to look for useful preparation work in your connected sources.</p></div>}
          {proposals.data?.map((proposal) => <article key={proposal.id} className="overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]" data-testid={`assistant-proposal-${proposal.id}`}>
             <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[hsl(var(--border))] bg-[hsl(76_35%_92%/.35)] px-5 py-5"><div><p className="font-mono text-[10px] uppercase tracking-[.14em] text-[hsl(var(--primary))]">{proposal.status}</p><h3 className="mt-2 font-serif text-2xl">{proposal.title}</h3><p className="mt-2 max-w-xl text-xs leading-5 text-[hsl(var(--muted-foreground))]">{proposal.summary}</p></div>{proposal.status === 'pending' && <div className="flex gap-2"><button type="button" onClick={() => rejectPlan.mutate({ proposalId: proposal.id })} disabled={approvePlan.isPending || rejectPlan.isPending} className="rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-xs font-semibold disabled:opacity-50">Dismiss plan</button><button type="button" onClick={() => approvePlan.mutate({ proposalId: proposal.id })} disabled={approvePlan.isPending || rejectPlan.isPending || proposal.tasks.some((task) => task.status === 'pending' && Boolean(task.proposedCategory))} className="rounded-xl bg-[hsl(var(--primary))] px-3 py-2 text-xs font-semibold text-[hsl(var(--primary-foreground))] disabled:opacity-50">{proposal.tasks.some((task) => task.status === 'pending' && Boolean(task.proposedCategory)) ? 'Resolve categories first' : approvePlan.isPending ? 'Adding…' : 'Approve plan'}</button></div>}</div>
            <div className="divide-y divide-[hsl(var(--border))]">{proposal.tasks.map((task) => {
               const source = proposal.sources.find((item) => item.sourceId === task.sourceId && item.sourceType === task.sourceType);
               return <div key={task.id} className="p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h4 className="text-sm font-semibold">{task.title}</h4><span className={`rounded-full px-2 py-0.5 font-mono text-[9px] uppercase ${task.urgency === 'Urgent' || task.urgency === 'High' ? 'bg-[hsl(0_72%_92%)] text-[hsl(0_55%_37%)]' : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]'}`}>{task.urgency}</span><span className="rounded-full bg-[hsl(42_74%_64%/.15)] px-2 py-0.5 font-mono text-[9px] uppercase">{task.confidence}% confidence</span></div><p className="mt-2 text-xs leading-5 text-[hsl(var(--muted-foreground))]">{task.rationale}</p>{task.proposedCategory && <p className="mt-2 rounded-lg bg-[hsl(42_74%_64%/.12)] px-3 py-2 text-[11px] leading-5 text-[hsl(26_55%_31%)]">Claude suggested <strong>{task.proposedCategory}</strong> as a new category. Choose the closest approved category in Edit & approve; repeat approval is unavailable for category changes.</p>}{task.assumptions.length > 0 && <p className="mt-2 rounded-lg bg-[hsl(42_74%_64%/.12)] px-3 py-2 text-[11px] leading-5 text-[hsl(26_55%_31%)]">Assumption: {task.assumptions.join(' · ')}</p>}<div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-[hsl(var(--muted-foreground))]"><span>{task.dueDate ? `Due ${new Date(task.dueDate).toLocaleDateString()}` : 'No inferred due date'}</span><span>{task.groupName}</span>{source && <span className="inline-flex items-center gap-1 rounded-md bg-[hsl(var(--muted)/.6)] px-2 py-1">{task.sourceType === 'gmail' ? <Mail size={12} /> : <CalendarDays size={12} />}{source.originLabel}</span>}{task.sourceLink && <a href={task.sourceLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-[hsl(var(--primary))]">{task.sourceType === 'gmail' ? <Mail size={12} /> : <CalendarDays size={12} />}Open source <ExternalLink size={11} /></a>}</div></div>
                  {task.status === 'pending' ? <div className="flex shrink-0 flex-wrap gap-2"><button type="button" onClick={() => rejectTask.mutate({ proposalId: proposal.id, taskId: task.id })} disabled={approveTask.isPending || rejectTask.isPending} className="rounded-xl border border-[hsl(var(--border))] p-2 text-[hsl(var(--muted-foreground))] disabled:opacity-50" aria-label={`Dismiss ${task.title}`}><X size={15} /></button>{!task.proposedCategory && <button type="button" onClick={() => approveTask.mutate({ proposalId: proposal.id, taskId: task.id })} disabled={approveTask.isPending || rejectTask.isPending} className="rounded-xl border border-[hsl(var(--primary))] px-3 py-2 text-xs font-semibold text-[hsl(var(--primary))] disabled:opacity-50">{approveTask.isPending ? 'Adding…' : 'Approve'}</button>}<button type="button" onClick={() => setEditingTask({ proposalId: proposal.id, task })} disabled={approveTask.isPending} className="rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-xs font-semibold disabled:opacity-50">{task.proposedCategory ? 'Choose category' : 'Edit & approve'}</button>{!task.proposedCategory && (task.sourceType === 'gmail' || (task.sourceType === 'calendar' && proposal.sources.some((source) => source.sourceType === 'calendar' && source.sourceId === task.sourceId && source.recurringId))) && <button type="button" onClick={() => approveFromNowOn(proposal, task)} disabled={approveTask.isPending} className="rounded-xl bg-[hsl(42_74%_64%)] px-3 py-2 text-xs font-semibold text-[hsl(26_55%_20%)] disabled:opacity-50">Approve from now on</button>}</div> : <span className="rounded-full bg-[hsl(76_35%_92%)] px-3 py-1.5 font-mono text-[10px] uppercase text-[hsl(155_28%_29%)]">{task.status.replace('_', ' ')}</span>}</div></div>;
            })}</div>
          </article>)}
        </main>
        <aside className="space-y-6">
          <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5" data-testid="panel-assistant-settings"><div className="flex items-center gap-3"><div className="flex size-10 items-center justify-center rounded-xl bg-[hsl(42_74%_64%/.18)] text-[hsl(26_55%_35%)]"><ShieldCheck size={19} /></div><div><p className="font-mono text-[10px] uppercase tracking-[.14em] text-[hsl(var(--primary))]">Owner controls</p><h2 className="mt-1 font-serif text-2xl">Planning guardrails</h2></div></div>
             {settings.data?.sourceScope && <div className="mt-5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/.3)] p-3 text-[11px] leading-5"><p className="font-mono text-[9px] uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">Connected sources · read only</p><p className="mt-2"><span className="font-semibold">Mailbox:</span> {settings.data.sourceScope.mailbox}</p><p><span className="font-semibold">Forwarded through:</span> {settings.data.sourceScope.forwardedSenders.join(' · ')}</p><p className="mt-2 font-semibold">Shared calendars</p><ul className="list-disc pl-4">{settings.data.sourceScope.calendars.map((calendar) => <li key={calendar.id}>{calendar.name}</li>)}</ul></div>}
             <label className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-[hsl(var(--border))] p-3 text-xs font-semibold"><span>Enable source scanning</span><button type="button" role="switch" aria-checked={settings.data?.enabled ?? false} onClick={() => updateSettings.mutate({ data: { enabled: !settings.data?.enabled } })} className={`relative h-7 w-12 rounded-full ${settings.data?.enabled ? 'bg-[hsl(var(--primary))]' : 'bg-[hsl(var(--muted))]'}`}><span className={`absolute top-1 size-5 rounded-full bg-white transition-transform ${settings.data?.enabled ? 'translate-x-6' : 'translate-x-1'}`} /></button></label>
            <label className="mt-4 block text-xs font-semibold">Calendar look-ahead<select id="assistant-lookahead" defaultValue={settings.data?.lookaheadDays ?? 45} className="field-input mt-2 w-full"><option value="14">14 days</option><option value="30">30 days</option><option value="45">45 days</option><option value="90">90 days</option></select></label>
            <label className="mt-4 block text-xs font-semibold">Editable farm / BioGro playbook<textarea id="assistant-playbook" defaultValue={settings.data?.playbook ?? ''} rows={9} className="field-input mt-2 w-full resize-y text-xs leading-5" /></label>
            <button type="button" onClick={saveSettings} disabled={updateSettings.isPending} className="mt-4 w-full rounded-xl bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-semibold text-[hsl(var(--primary-foreground))] disabled:opacity-50">Save guardrails</button><p className="mt-3 text-[11px] leading-5 text-[hsl(var(--muted-foreground))]">This playbook is your own working guidance. Claude is told not to invent official requirements.</p>
          </section>
          <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5" data-testid="panel-approval-rules"><p className="font-mono text-[10px] uppercase tracking-[.14em] text-[hsl(var(--primary))]">Visible & revocable</p><h2 className="mt-1 font-serif text-2xl">Repeat approvals</h2><p className="mt-2 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Only high-confidence suggestions matching one of these narrow rules can be approved automatically.</p><div className="mt-4 space-y-3">{!rules.data?.length && <p className="rounded-xl bg-[hsl(var(--muted)/.5)] px-3 py-3 text-xs text-[hsl(var(--muted-foreground))]">No repeat approval rules yet.</p>}{rules.data?.map((rule) => <div key={rule.id} className="rounded-xl border border-[hsl(var(--border))] p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold">{rule.name}</p><p className="mt-1 text-[11px] leading-4 text-[hsl(var(--muted-foreground))]">{rule.scopeDescription}</p>{rule.expiresAt && <p className="mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">Expires {new Date(rule.expiresAt).toLocaleDateString()}</p>}</div><button type="button" onClick={() => updateRule.mutate({ ruleId: rule.id, data: { active: !rule.active } })} className="rounded-lg border border-[hsl(var(--border))] p-2" aria-label={rule.active ? `Pause ${rule.name}` : `Resume ${rule.name}`}>{rule.active ? <Pause size={14} /> : <Play size={14} />}</button></div><div className="mt-3 flex gap-2"><button type="button" onClick={() => editRule(rule)} className="rounded-lg border border-[hsl(var(--border))] px-2.5 py-1.5 text-[10px] font-semibold">Edit</button>{rule.active && <button type="button" onClick={() => updateRule.mutate({ ruleId: rule.id, data: { active: false } })} className="rounded-lg border border-[hsl(0_48%_70%)] px-2.5 py-1.5 text-[10px] font-semibold text-[hsl(0_55%_37%)]">Revoke</button>}</div><p className={`mt-2 font-mono text-[9px] uppercase ${rule.active ? 'text-[hsl(155_28%_29%)]' : 'text-[hsl(var(--muted-foreground))]'}`}>{rule.active ? 'Active' : 'Paused / revoked'}</p></div>)}</div>
          </section>
        </aside>
      </div>
      {editingTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setEditingTask(null)}>
          <div className="w-full max-w-md rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-serif text-2xl text-[hsl(var(--foreground))]">Edit & Approve</h3>
            {editingTask.task.proposedCategory && <p className="mt-2 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Claude suggested “{editingTask.task.proposedCategory}”. Select the closest approved category below.</p>}
            <form onSubmit={handleEditAndApproveSubmit} className="mt-5 space-y-4">
              <label className="block text-xs font-semibold">Title<input name="title" defaultValue={editingTask.task.title} required className="field-input mt-1.5 w-full" /></label>
              <label className="block text-xs font-semibold">Group
                <select name="groupName" defaultValue={editingTask.task.groupName} required className="field-input mt-1.5 w-full">
                  <option value="Orchards">Orchards</option>
                  <option value="Planting">Planting</option>
                  <option value="Gullies">Gullies</option>
                  <option value="Repair">Repair</option>
                  <option value="Trapping">Trapping</option>
                  <option value="Admin">Admin</option>
                  <option value="Yurts">Yurts</option>
                  <option value="Meat">Meat</option>
                  <option value="Pommeu">Pommeu</option>
                </select>
              </label>
              <label className="block text-xs font-semibold">Due Date (YYYY-MM-DD)<input name="dueDate" defaultValue={editingTask.task.dueDate ? editingTask.task.dueDate.slice(0,10) : ''} className="field-input mt-1.5 w-full" placeholder="e.g. 2024-11-20" /></label>
              <label className="block text-xs font-semibold">Notes<textarea name="notes" defaultValue={editingTask.task.notes} className="field-input mt-1.5 w-full resize-y" rows={3} /></label>
              <div className="flex justify-end gap-3 mt-6">
                <button type="button" onClick={() => setEditingTask(null)} className="rounded-xl px-4 py-2.5 text-xs font-semibold text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]">Cancel</button>
                <button type="submit" className="rounded-xl bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-semibold text-[hsl(var(--primary-foreground))]">Approve</button>
              </div>
            </form>
          </div>
        </div>
       )}</>}
    </div>
  </PlannerShell>;
}