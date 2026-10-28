import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import {
  customFetch,
  getGetTodaysDailyPlanQueryKey,
  getListAssistantProposalsQueryKey,
  getListFarmTasksQueryKey,
  type AssistantProposalTask,
  type FarmTask,
  useApproveAssistantProposalTask,
  useGetTodaysDailyPlan,
  useListAssistantProposals,
  useListFarmTasks,
  useRefreshDailyPlan,
  useRejectAssistantProposalTask,
  getListPendingFarmTasksQueryKey,
  useListPendingFarmTasks,
  useApproveFarmTask,
  useRejectFarmTask,
  useGetFarmSettings,
} from '@workspace/api-client-react';
import { PlannerTaskCard } from '@/components/PlannerTaskCard';
import { ConnectionNotice } from '@/components/ConnectionNotice';
import { QuickTaskSheet } from '@/components/QuickTaskSheet';
import { TaskDetailsSheet } from '@/components/TaskDetailsSheet';
import { type LocalAttachment } from '@/components/AttachmentPicker';
import { useColors } from '@/hooks/useColors';
import { useCachedDailyPlan } from '@/hooks/useCachedDailyPlan';
import { useAccountIdentity } from '@/hooks/useAccountIdentity';
import { useFarmTaskAttachments } from '@/hooks/useFarmTaskAttachments';
import { useMobileFieldbook } from '@/hooks/useMobileFieldbook';
import { resolveDailyPlan, selectDailyBriefState } from '@/lib/daily-brief';
import { TASK_CATEGORIES } from '@/lib/task-categories';
import { monthOptions } from '@/lib/task-month';

type Member = { clerkId: string; role: string; isHarnold?: boolean };
type Worker = { clerkId: string; displayName: string; status: string };
type PendingProposal = AssistantProposalTask & { proposalId: number };

export default function TodayScreen() {
  const colors = useColors();
  const activeIdentity = useAccountIdentity();
  const [detailTask, setDetailTask] = useState<FarmTask>();
  const [addOpen, setAddOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState('');
  const attachments = useFarmTaskAttachments();
  const memberQuery = useQuery({
    queryKey: ['/api/me', activeIdentity],
    queryFn: () => customFetch<Member>('/api/me'),
    enabled: Boolean(activeIdentity),
  });
  const verifiedMember = memberQuery.data?.clerkId === activeIdentity ? memberQuery.data : null;
  const isOwner = verifiedMember?.role === 'master';
  const isHarnold = verifiedMember?.isHarnold === true;
  const accountScope = verifiedMember?.clerkId ?? null;
  const farmSettings = useGetFarmSettings({
    query: { queryKey: ['/api/farm-settings', accountScope], enabled: Boolean(accountScope) },
  });
  const workersQuery = useQuery({
    queryKey: ['/api/team', accountScope],
    queryFn: () => customFetch<Worker[]>('/api/team'),
    enabled: Boolean(accountScope && (isOwner || isHarnold)),
  });
  const tasksQuery = useListFarmTasks({ includeDone: true }, {
    query: { queryKey: [...getListFarmTasksQueryKey({ includeDone: true }), activeIdentity], enabled: Boolean(activeIdentity), staleTime: 30_000 },
  });
  const planQuery = useGetTodaysDailyPlan({
    query: { queryKey: [...getGetTodaysDailyPlanQueryKey(), activeIdentity], enabled: Boolean(activeIdentity), refetchInterval: 30000 },
  });
  const proposalsQuery = useListAssistantProposals(undefined, {
    query: { queryKey: [...getListAssistantProposalsQueryKey(), accountScope], enabled: Boolean(accountScope) && isOwner },
  });
  const pendingTasksQuery = useListPendingFarmTasks({
    query: { queryKey: [...getListPendingFarmTasksQueryKey(), accountScope], enabled: Boolean(accountScope) && isHarnold, refetchInterval: 30000 },
  });
  const fieldbook = useMobileFieldbook(
    accountScope,
    tasksQuery.data?.tasks,
    tasksQuery.isSuccess || tasksQuery.isError,
  );
  const cachedPlan = useCachedDailyPlan(accountScope, planQuery.data);
  const activePlan = accountScope && cachedPlan.readyForScope ? cachedPlan.plan : undefined;
  const tasks = accountScope && fieldbook.readyForScope
    ? (fieldbook.tasks.length ? fieldbook.tasks : (tasksQuery.data?.tasks ?? []))
    : [];
  const availableMonths = monthOptions(tasks);
  const groups = useMemo(
    () => resolveDailyPlan(activePlan, tasks, accountScope ? { id: accountScope, isOwner } : undefined),
    [accountScope, activePlan, isOwner, tasks],
  );
  const state = selectDailyBriefState({
    loading: memberQuery.isLoading || !accountScope || planQuery.isLoading || tasksQuery.isLoading || !fieldbook.readyForScope || !cachedPlan.readyForScope,
    hasCachedPlan: Boolean(activePlan),
    hasError: planQuery.isError || tasksQuery.isError || !fieldbook.online || cachedPlan.isCached,
    groups,
  });
  const apiFailure = memberQuery.isError
    ? {
        title: 'Could not verify your account',
        message: 'The planner server could not be reached. Check your connection and try again.',
        retry: () => memberQuery.refetch(),
        retrying: memberQuery.isRefetching,
      }
    : tasksQuery.isError
      ? {
          title: 'Could not load your tasks',
          message: 'Your saved fieldbook may still be available. Retry when you have a connection.',
          retry: () => tasksQuery.refetch(),
          retrying: tasksQuery.isRefetching,
        }
      : planQuery.isError
        ? {
            title: 'Could not load today’s brief',
            message: 'Your saved brief may still be available. Retry when you have a connection.',
            retry: () => planQuery.refetch(),
            retrying: planQuery.isRefetching,
          }
        : null;
  const pendingProposals = useMemo<PendingProposal[]>(() =>
    proposalsQuery.data?.flatMap((proposal) =>
      proposal.tasks
        .filter((task) => task.status === 'pending')
        .map((task) => ({ ...task, proposalId: proposal.id })),
    ) ?? [], [proposalsQuery.data]);

  useEffect(() => {
    setDetailTask(undefined);
    setCollapsedGroups({});
    setMessage('');
  }, [activeIdentity]);

  useEffect(() => {
    if (!accountScope || accountScope === 'signed-in') return;
    void AsyncStorage.multiRemove([
      'farm-planner-mobile-fieldbook:signed-in',
      'farm-planner-mobile-daily-plan:signed-in',
    ]);
  }, [accountScope]);

  const refreshPlan = useRefreshDailyPlan({
    mutation: {
      onSuccess: () => {
        setMessage('Daily plan refreshed.');
        void planQuery.refetch();
      },
      onError: () => setMessage('The plan could not be regenerated. Your saved brief is still available.'),
    },
  });
  const approveTask = useApproveAssistantProposalTask({
    mutation: {
      onSuccess: async () => {
        setMessage('Suggestion approved and added to the fieldbook.');
        await fieldbook.refresh();
        await Promise.all([proposalsQuery.refetch(), tasksQuery.refetch(), planQuery.refetch()]);
      },
      onError: () => setMessage('The suggestion could not be approved.'),
    },
  });
  const rejectTask = useRejectAssistantProposalTask({
    mutation: {
      onSuccess: () => {
        setMessage('Suggestion dismissed.');
        void proposalsQuery.refetch();
      },
      onError: () => setMessage('The suggestion could not be dismissed.'),
    },
  });
  const approveWorkerTask = useApproveFarmTask({
    mutation: {
      onSuccess: () => { setMessage('Worker submission approved.'); void pendingTasksQuery.refetch(); void fieldbook.refresh(); },
      onError: () => setMessage('The worker submission could not be approved.'),
    },
  });
  const rejectWorkerTask = useRejectFarmTask({
    mutation: {
      onSuccess: () => { setMessage('Worker submission rejected.'); void pendingTasksQuery.refetch(); },
      onError: () => setMessage('The worker submission could not be rejected.'),
    },
  });

  const refresh = () => {
    setMessage('');
    void fieldbook.refresh();
    void Promise.all([tasksQuery.refetch(), planQuery.refetch(), isOwner ? proposalsQuery.refetch() : Promise.resolve()]);
  };

  const handleCreate = (
    task: Parameters<NonNullable<React.ComponentProps<typeof QuickTaskSheet>['onCreate']>>[0],
    files: LocalAttachment[],
  ) => {
    void fieldbook.saveTask(undefined, task).then(async (created) => {
      if (!created) throw new Error('The account is not ready.');
      setAddOpen(false);
       setMessage(files.length ? `${isOwner ? 'Task added' : 'Task submitted for Harnold’s review'}. Attachments will upload after the task syncs.` : isOwner ? 'Task added. Syncing to the fieldbook…' : 'Task submitted for Harnold’s review. Syncing to the fieldbook…');
      const synced = await fieldbook.refresh();
      if (files.length) {
        if (!synced) {
          setMessage('Task added. Attachments are queued until the task syncs.');
          return;
        }
        const result = await attachments.upload(created.id, files);
        if (result.failed.length) Alert.alert('Some attachments could not upload', result.failed.join('\n'));
      }
      if (synced) {
        if (isOwner) refreshPlan.mutate();
        else await planQuery.refetch();
      }
    }).catch(() => Alert.alert('Could not add task', 'The task was not saved. Check the connection and try again.'));
  };

  const toggle = (task: FarmTask) => {
    const done = !task.done;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    void fieldbook.saveTask(task, { task: task.task, done }).then(() => {
      setMessage(fieldbook.online ? (done ? 'Marked complete. Tap again to reopen.' : 'Task reopened.') : 'Saved offline. This change will sync automatically.');
    });
  };

  const showConflict = () => {
    if (!accountScope || !fieldbook.readyForScope) return;
    const conflict = fieldbook.conflicts[0];
    if (!conflict) return;
    Alert.alert('This task changed elsewhere', conflict.localTask.task, [
      { text: 'Use shared version', onPress: () => void fieldbook.resolveConflict(conflict, 'server') },
      { text: 'Keep my version', onPress: () => void fieldbook.resolveConflict(conflict, 'local') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={tasksQuery.isRefetching || planQuery.isRefetching || fieldbook.syncing} onRefresh={refresh} tintColor={colors.primary} />}
      >
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={[styles.kicker, { color: colors.primary }]}>TODAY</Text>
            <Text style={[styles.title, { color: colors.foreground }]}>Today&apos;s work.</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Automatically prepared fieldbook plan.</Text>
          </View>
          {isOwner ? (
            <View style={styles.ownerActions}>
              <Pressable testID="refresh-daily-plan" accessibilityRole="button" accessibilityLabel="Regenerate daily plan" onPress={() => refreshPlan.mutate()} disabled={refreshPlan.isPending} style={({ pressed }) => [styles.actionButton, { opacity: refreshPlan.isPending ? 0.55 : pressed ? 0.7 : 1 }]}>
                {refreshPlan.isPending ? <ActivityIndicator size="small" color={colors.primary} /> : <Feather name="refresh-cw" size={21} color={colors.primary} />}
              </Pressable>
              <Pressable testID="open-daily-settings" accessibilityRole="button" accessibilityLabel="Open daily plan settings" onPress={() => router.push('/(tabs)/settings')} style={({ pressed }) => [styles.actionButton, { opacity: pressed ? 0.7 : 1 }]}>
                <Feather name="settings" size={21} color={colors.primary} />
              </Pressable>
            </View>
          ) : null}
        </View>

        <View style={[styles.syncBar, { borderColor: colors.border }]}>
          <View style={[styles.statusDot, { backgroundColor: fieldbook.online ? colors.primary : colors.accent }]} />
          <Text style={[styles.syncText, { color: colors.mutedForeground }]}>
            {!fieldbook.online ? `Offline · ${fieldbook.pendingCount} pending` : fieldbook.syncing ? 'Syncing fieldbook…' : fieldbook.pendingCount ? `${fieldbook.pendingCount} pending sync` : 'Fieldbook synced'}
          </Text>
          {activePlan ? (
            <Text style={[styles.generated, { color: colors.mutedForeground }]}>
              {activePlan.generatedBy === 'claude' ? 'Claude prepared' : 'Rules prepared'}
            </Text>
          ) : null}
        </View>

        {message ? (
          <Pressable testID="daily-message" accessibilityRole="button" accessibilityLabel="Dismiss notification" onPress={() => setMessage('')} style={({ pressed }) => [styles.banner, { backgroundColor: colors.secondary, opacity: pressed ? 0.78 : 1 }]}>
            <Text style={[styles.bannerText, { color: colors.secondaryForeground }]}>{message}</Text>
            <Feather name="x" size={16} color={colors.mutedForeground} />
          </Pressable>
        ) : null}
        {apiFailure ? (
          <ConnectionNotice
            title={apiFailure.title}
            message={apiFailure.message}
            onRetry={() => void apiFailure.retry()}
            retrying={apiFailure.retrying}
          />
        ) : null}
        {state === 'fallback' ? (
          <View testID="daily-plan-fallback" style={[styles.banner, { backgroundColor: colors.secondary }]}>
            <Feather name="cloud-off" size={16} color={colors.primary} />
            <Text style={[styles.bannerText, { color: colors.secondaryForeground }]}>Showing your saved brief. Pull to reconnect.</Text>
          </View>
        ) : null}
        {accountScope && fieldbook.readyForScope && fieldbook.conflicts.length ? (
          <Pressable testID="resolve-task-conflict" onPress={showConflict} style={[styles.banner, { backgroundColor: colors.accent }]}>
            <Feather name="alert-triangle" size={16} color={colors.accentForeground} />
            <Text style={[styles.bannerText, { color: colors.accentForeground }]}>A task changed elsewhere. Tap to choose which version to keep.</Text>
          </Pressable>
        ) : null}

        {state === 'loading' ? (
          <View testID="daily-plan-loading" style={styles.loading}><ActivityIndicator size="large" color={colors.primary} /></View>
        ) : state === 'empty' ? (
          <View testID="daily-plan-empty" style={styles.empty}>
            <Feather name="sun" size={28} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No work in today&apos;s brief</Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Pull down to check for a newly prepared plan.</Text>
          </View>
        ) : (
          <View testID="daily-plan-ready" style={styles.groups}>
            {groups.map((group) => {
              const collapsed = Boolean(collapsedGroups[group.name]);
              const slug = group.name.toLowerCase().replace(/\s+/g, '-');
              return (
                <View key={group.name} testID={`daily-plan-group-${slug}`} style={[styles.group, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Pressable
                    testID={`toggle-daily-plan-group-${slug}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${group.name}, ${collapsed ? 'collapsed' : 'expanded'}, ${group.openCount} open`}
                    accessibilityState={{ expanded: !collapsed }}
                    onPress={() => setCollapsedGroups((current) => ({ ...current, [group.name]: !current[group.name] }))}
                    style={[styles.groupHeader, { backgroundColor: colors.muted }]}
                  >
                    <View style={[styles.groupDot, { backgroundColor: colors.accent }]} />
                    <Text style={[styles.groupTitle, { color: colors.foreground }]}>{group.name}</Text>
                    <Text style={[styles.groupCount, { color: colors.mutedForeground }]}>{group.openCount} open</Text>
                    <Feather name={collapsed ? 'chevron-down' : 'chevron-up'} size={17} color={colors.mutedForeground} />
                  </Pressable>
                  {!collapsed ? (
                    <View style={styles.taskList}>
                      {group.tasks.map((task) => (
                        <PlannerTaskCard key={task.id} compact task={task} onToggle={toggle} onOpen={setDetailTask} />
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}

        {isOwner && pendingProposals.length ? (
          <View testID="assistant-suggestions" style={[styles.suggestions, { borderColor: colors.accent, backgroundColor: colors.card }]}>
            <View style={styles.suggestionHeading}>
              <Feather name="message-square" size={18} color={colors.primary} />
              <Text style={[styles.suggestionTitle, { color: colors.foreground }]}>Suggestions to review</Text>
              <Text style={[styles.suggestionCount, { color: colors.mutedForeground }]}>{pendingProposals.length}</Text>
            </View>
            {pendingProposals.slice(0, 3).map((suggestion) => (
              <View key={suggestion.id} testID={`assistant-suggestion-${suggestion.id}`} style={[styles.suggestion, { borderTopColor: colors.border }]}>
                <Text style={[styles.suggestionTask, { color: colors.foreground }]}>{suggestion.title}</Text>
                <Text numberOfLines={2} style={[styles.suggestionReason, { color: colors.mutedForeground }]}>{suggestion.rationale}</Text>
                {suggestion.proposedCategory ? (
                  <Text style={[styles.categoryWarning, { color: colors.destructive }]}>Needs an approved category before it can be added. Review this suggestion on the web.</Text>
                ) : null}
                <View style={styles.proposalActions}>
                  <Pressable testID={`dismiss-suggestion-${suggestion.id}`} onPress={() => rejectTask.mutate({ proposalId: suggestion.proposalId, taskId: suggestion.id })} disabled={approveTask.isPending || rejectTask.isPending}>
                    <Text style={[styles.dismissText, { color: colors.mutedForeground }]}>Dismiss</Text>
                  </Pressable>
                  {!suggestion.proposedCategory ? (
                    <Pressable testID={`approve-suggestion-${suggestion.id}`} onPress={() => approveTask.mutate({ proposalId: suggestion.proposalId, taskId: suggestion.id })} disabled={approveTask.isPending || rejectTask.isPending} style={[styles.approveButton, { backgroundColor: colors.primary }]}>
                      <Text style={[styles.approveText, { color: colors.primaryForeground }]}>Approve</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        ) : null}
        {isHarnold && pendingTasksQuery.data?.tasks.length ? (
          <View testID="worker-submissions" style={[styles.suggestions, { borderColor: colors.primary, backgroundColor: colors.card }]}>
            <View style={styles.suggestionHeading}>
              <Feather name="check-circle" size={18} color={colors.primary} />
              <Text style={[styles.suggestionTitle, { color: colors.foreground }]}>Worker submissions</Text>
              <Text style={[styles.suggestionCount, { color: colors.mutedForeground }]}>{pendingTasksQuery.data.tasks.length}</Text>
            </View>
            {pendingTasksQuery.data.tasks.map((task) => (
              <View key={task.id} testID={`worker-submission-${task.id}`} style={[styles.suggestion, { borderTopColor: colors.border }]}>
                <Text style={[styles.suggestionTask, { color: colors.foreground }]}>{task.task}</Text>
                <Text style={[styles.suggestionReason, { color: colors.mutedForeground }]}>{task.submittedByName || 'Worker'} · {task.group}{task.location ? ` · ${task.location}` : ''}</Text>
                <View style={styles.proposalActions}>
                  <Pressable testID={`approve-worker-${task.id}`} onPress={() => approveWorkerTask.mutate({ taskId: task.id })} disabled={approveWorkerTask.isPending || rejectWorkerTask.isPending} style={[styles.approveButton, { backgroundColor: colors.primary }]}>
                    <Text style={[styles.approveText, { color: colors.primaryForeground }]}>Approve</Text>
                  </Pressable>
                  <Pressable testID={`reject-worker-${task.id}`} onPress={() => Alert.prompt('Reject submission', 'Add a short reason.', (reviewNote) => { if (reviewNote?.trim()) rejectWorkerTask.mutate({ taskId: task.id, data: { reviewNote: reviewNote.trim() } }); })} disabled={approveWorkerTask.isPending || rejectWorkerTask.isPending}>
                    <Text style={[styles.dismissText, { color: colors.destructive }]}>Reject</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
      <Pressable testID="add-task" accessibilityRole="button" accessibilityLabel="Add task" onPress={() => setAddOpen(true)} style={({ pressed }) => [styles.fab, { backgroundColor: colors.accent, opacity: pressed ? 0.8 : 1 }]}>
        <Feather name="plus" size={24} color={colors.accentForeground} />
      </Pressable>
      <QuickTaskSheet
        visible={addOpen}
        saving={false}
        onClose={() => setAddOpen(false)}
         groups={farmSettings.data?.groups ?? TASK_CATEGORIES}
        months={availableMonths}
         locations={farmSettings.data?.locations ?? []}
         defaultGroup={farmSettings.data?.defaultGroup}
         defaultUrgency={farmSettings.data?.defaultUrgency}
         defaultLocation={farmSettings.data?.defaultLocation}
        workers={workersQuery.data ?? []}
         canAssign={isOwner || isHarnold}
        onCreate={handleCreate}
        onUpdate={() => undefined}
      />
      <TaskDetailsSheet
        task={accountScope ? detailTask : undefined}
        visible={Boolean(accountScope && detailTask)}
        onClose={() => setDetailTask(undefined)}
        onOpenAttachment={(attachmentId) => {
          void attachments.open(attachmentId).catch((error) => {
            Alert.alert('Could not open attachment', error instanceof Error ? error.message : 'Please try again.');
          });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 118, gap: 14 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  headerCopy: { flex: 1 },
  kicker: { fontSize: 11, letterSpacing: 1.4, fontWeight: '800', marginBottom: 6 },
  title: { fontSize: 31, fontWeight: '800', letterSpacing: -0.7 },
  subtitle: { fontSize: 14, marginTop: 4, lineHeight: 20 },
  ownerActions: { flexDirection: 'row', gap: 18, paddingTop: 10, minHeight: 44, alignItems: 'center' },
  actionButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  syncBar: { minHeight: 38, borderTopWidth: 1, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 7 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  syncText: { flex: 1, fontSize: 11, fontWeight: '600' },
  generated: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  banner: { minHeight: 44, borderRadius: 13, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 9 },
  bannerText: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: '600' },
  loading: { minHeight: 260, alignItems: 'center', justifyContent: 'center' },
  empty: { minHeight: 260, alignItems: 'center', justifyContent: 'center', gap: 9 },
  emptyTitle: { fontSize: 18, fontWeight: '800' },
  emptyText: { fontSize: 13, lineHeight: 19, textAlign: 'center' },
  groups: { gap: 14 },
  group: { borderWidth: 1, borderRadius: 17, overflow: 'hidden' },
  groupHeader: { minHeight: 48, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 9 },
  groupDot: { width: 8, height: 8, borderRadius: 4 },
  groupTitle: { flex: 1, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1.2 },
  groupCount: { fontSize: 11, fontWeight: '700' },
  taskList: { padding: 8, gap: 8 },
  suggestions: { borderWidth: 1, borderRadius: 17, padding: 14 },
  suggestionHeading: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 5 },
  suggestionTitle: { flex: 1, fontSize: 17, fontWeight: '800' },
  suggestionCount: { fontSize: 12, fontWeight: '800' },
  suggestion: { borderTopWidth: 1, paddingTop: 12, marginTop: 10, gap: 5 },
  suggestionTask: { fontSize: 14, fontWeight: '800' },
  suggestionReason: { fontSize: 12, lineHeight: 17 },
  categoryWarning: { fontSize: 11, lineHeight: 16, fontWeight: '700' },
  proposalActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 18, minHeight: 40 },
  dismissText: { fontSize: 12, fontWeight: '800' },
  approveButton: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 },
  approveText: { fontSize: 12, fontWeight: '800' },
  fab: { position: 'absolute', right: 22, bottom: 92, width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', elevation: 5 },
});
