import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { customFetch, getListFarmTasksQueryKey, type FarmTask, type TaskInput, useListFarmTasks } from '@workspace/api-client-react';
import { PlannerTaskCard } from '@/components/PlannerTaskCard';
import { QuickTaskSheet } from '@/components/QuickTaskSheet';
import { StartupStatus } from '@/components/StartupStatus';
import { TaskDetailsSheet } from '@/components/TaskDetailsSheet';
import { type LocalAttachment } from '@/components/AttachmentPicker';
import { useAccountIdentity } from '@/hooks/useAccountIdentity';
import { useColors } from '@/hooks/useColors';
import { useFarmTaskAttachments } from '@/hooks/useFarmTaskAttachments';
import { useMobileFieldbook } from '@/hooks/useMobileFieldbook';
import { TASK_CATEGORIES } from '@/lib/task-categories';
import { buildPlannerAgenda, plannerDateLabel, plannerDateKeys, plannerRangeLabel, plannerTodayKey, selectPlannerTasks, shiftPlannerDate } from '@/lib/planner-30-day';
import { monthOptions } from '@/lib/task-month';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Member = { clerkId: string; role: string; isHarnold?: boolean };
type Worker = { clerkId: string; displayName: string; status: string };
type PlannerView = 'Open' | 'All';

export default function PlannerScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const activeIdentity = useAccountIdentity();
  const [startKey, setStartKey] = useState(() => plannerTodayKey());
  const [view, setView] = useState<PlannerView>('Open');
  const [detailTask, setDetailTask] = useState<FarmTask>();
  const [editingTask, setEditingTask] = useState<FarmTask>();
  const [message, setMessage] = useState('');
  const attachments = useFarmTaskAttachments();

  const memberQuery = useQuery({
    queryKey: ['/api/me', activeIdentity],
    queryFn: () => customFetch<Member>('/api/me'),
    enabled: Boolean(activeIdentity),
  });
  const verifiedMember = memberQuery.data?.clerkId === activeIdentity ? memberQuery.data : null;
  const accountScope = activeIdentity ?? null;
  const isOwner = verifiedMember?.role === 'master';
  const isHarnold = verifiedMember?.isHarnold === true;
  const canManage = isOwner || isHarnold;
  const workersQuery = useQuery({
    queryKey: ['/api/team', accountScope],
    queryFn: () => customFetch<Worker[]>('/api/team'),
    enabled: Boolean(accountScope && canManage),
  });
  const tasksQuery = useListFarmTasks({ includeDone: true }, {
    query: {
      queryKey: [...getListFarmTasksQueryKey({ includeDone: true }), accountScope],
      enabled: Boolean(accountScope),
      staleTime: 30_000,
    },
  });
  const remoteTasks = tasksQuery.data?.tasks;
  const remoteTasksReady = tasksQuery.isSuccess || tasksQuery.isError;
  const fieldbook = useMobileFieldbook(accountScope, remoteTasks, remoteTasksReady);
  const scopedTasks = accountScope && fieldbook.readyForScope
    ? (fieldbook.tasks.length ? fieldbook.tasks : (tasksQuery.data?.tasks ?? []))
    : [];
  const allTasks = useMemo(() => selectPlannerTasks(scopedTasks, accountScope ?? '', canManage, true), [accountScope, canManage, scopedTasks]);
  const visibleTasks = useMemo(() => selectPlannerTasks(scopedTasks, accountScope ?? '', canManage, view === 'All'), [accountScope, canManage, scopedTasks, view]);
  const dateKeys = useMemo(() => plannerDateKeys(startKey), [startKey]);
  const agenda = useMemo(() => buildPlannerAgenda(visibleTasks, startKey), [startKey, visibleTasks]);
  const agendaTaskCount = agenda.overdue.length + agenda.unscheduled.length + agenda.days.reduce((total, day) => total + day.tasks.length, 0);
  const todayKey = plannerTodayKey();
  const rangeLabel = plannerRangeLabel(dateKeys[0], dateKeys[dateKeys.length - 1]);
  const availableMonths = useMemo(() => monthOptions(allTasks), [allTasks]);

  useEffect(() => {
    setStartKey(plannerTodayKey());
    setDetailTask(undefined);
    setEditingTask(undefined);
    setMessage('');
  }, [activeIdentity]);

  const refresh = useCallback(() => {
    setMessage('');
    void fieldbook.refresh();
    void tasksQuery.refetch();
  }, [fieldbook, tasksQuery]);

  const toggle = useCallback((task: FarmTask) => {
    const done = !task.done;
    Alert.alert(done ? 'Mark task complete?' : 'Reopen task?', task.task, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: done ? 'Mark complete' : 'Reopen',
        onPress: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          void fieldbook.saveTask(task, { task: task.task, done }).then(() => {
            setMessage(fieldbook.online ? (done ? 'Task marked complete.' : 'Task reopened.') : 'Saved offline. This change will sync automatically.');
          }).catch(() => {
            Alert.alert('Could not save task', 'Please try again when the connection is available.');
          });
        },
      },
    ]);
  }, [fieldbook]);

  const cycleUrgency = useCallback((task: FarmTask) => {
    const order: FarmTask['urgency'][] = ['Urgent', 'High', 'Medium', 'Low'];
    const next = order[(order.indexOf(task.urgency) + 1) % order.length];
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void fieldbook.saveTask(task, { task: task.task, urgency: next }).then(() => {
      setMessage(fieldbook.online ? `Priority changed to ${next}.` : 'Priority saved offline. This change will sync automatically.');
    }).catch(() => {
      Alert.alert('Could not save priority', 'Please try again when the connection is available.');
    });
  }, [fieldbook]);

  const handleUpdate = useCallback((taskId: string, data: TaskInput) => {
    const task = allTasks.find((item) => item.id === taskId) ?? editingTask;
    if (!task) return;
    void fieldbook.saveTask(task, data).then(() => {
      setEditingTask(undefined);
      setDetailTask(undefined);
      setMessage(fieldbook.online ? 'Task changes saved.' : 'Saved offline. This change will sync automatically.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }).catch(() => {
      Alert.alert('Could not save task', 'Please try again when the connection is available.');
    });
  }, [allTasks, editingTask, fieldbook]);

  const handleAttach = useCallback((task: FarmTask, files: LocalAttachment[]) => {
    void attachments.upload(task.id, files).then((result) => {
      if (result.failed.length) Alert.alert('Some attachments could not upload', result.failed.join('\n'));
    });
  }, [attachments]);

  const handleDeleteAttachment = useCallback((attachmentId: string) => {
    Alert.alert('Remove attachment?', 'This permanently removes the protected file from this task.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          void attachments.remove(attachmentId).catch((error) => {
            Alert.alert('Could not remove attachment', error instanceof Error ? error.message : 'Please try again.');
          });
        },
      },
    ]);
  }, [attachments]);

  const handleOpenAttachment = useCallback((attachmentId: string) => {
    void attachments.open(attachmentId).catch((error) => {
      Alert.alert('Could not open attachment', error instanceof Error ? error.message : 'Please try again.');
    });
  }, [attachments]);

  const showConflict = () => {
    const conflict = fieldbook.conflicts[0];
    if (!conflict) return;
    Alert.alert('This task changed elsewhere', conflict.localTask.task, [
      { text: 'Use shared version', onPress: () => void fieldbook.resolveConflict(conflict, 'server') },
      { text: 'Keep my version', onPress: () => void fieldbook.resolveConflict(conflict, 'local') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  if (memberQuery.isError && !fieldbook.readyForScope) {
    return <StartupStatus kind="api" title="Could not verify your account" message="The planner server could not be reached. Check your connection and try again." actionLabel="Retry connection" onAction={() => void memberQuery.refetch()} busy={memberQuery.isRefetching} />;
  }
  if (tasksQuery.isError && !fieldbook.readyForScope) {
    return <StartupStatus kind="api" title="Could not load your planner" message="Your saved fieldbook may still be available. Retry when you have a connection." actionLabel="Retry connection" onAction={() => void tasksQuery.refetch()} busy={tasksQuery.isRefetching} />;
  }
  if (!accountScope || !fieldbook.readyForScope) {
    return <StartupStatus kind="loading" title="Loading your planner" message="The 30-day fieldbook is being prepared." />;
  }

  const hasAgendaTasks = agenda.overdue.length > 0 || agenda.unscheduled.length > 0 || agenda.days.some((day) => day.tasks.length > 0);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: Platform.OS === 'web' ? 67 : insets.top + 16 }]}>
        <View style={styles.headerTop}>
          <View style={styles.headerCopy}>
            <Text style={[styles.kicker, { color: colors.primary }]}>FIELD PLANNER</Text>
            <Text style={[styles.title, { color: colors.foreground }]}>30-day planner</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{rangeLabel}</Text>
          </View>
          <View style={[styles.syncStatus, { backgroundColor: colors.secondary }]}>
            {fieldbook.syncing ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : fieldbook.pendingCount > 0 ? (
              <Feather name="cloud-off" size={14} color={colors.accent} />
            ) : fieldbook.online ? (
              <Feather name="cloud" size={14} color={colors.primary} />
            ) : (
              <Feather name="cloud-off" size={14} color={colors.mutedForeground} />
            )}
            <Text style={[styles.syncText, { color: fieldbook.pendingCount > 0 ? colors.accent : colors.mutedForeground }]}>
              {fieldbook.syncing ? 'Syncing…' : fieldbook.pendingCount ? `${fieldbook.pendingCount} pending` : fieldbook.online ? 'Up to date' : 'Offline'}
            </Text>
          </View>
        </View>
        <View style={styles.navigation}>
          <Pressable testID="planner-previous-window" accessibilityRole="button" accessibilityLabel="Move planner back 7 days" onPress={() => setStartKey((current) => shiftPlannerDate(current, -7))} style={({ pressed }) => [styles.navButton, { borderColor: colors.border, backgroundColor: colors.card, opacity: pressed ? 0.72 : 1 }]}>
            <Feather name="chevron-left" size={20} color={colors.foreground} />
          </Pressable>
          <Pressable testID="planner-today" accessibilityRole="button" accessibilityLabel="Show today in planner" onPress={() => setStartKey(plannerTodayKey())} style={({ pressed }) => [styles.todayButton, { borderColor: colors.border, backgroundColor: colors.card, opacity: pressed ? 0.72 : 1 }]}>
            <Feather name="calendar" size={16} color={colors.primary} />
            <Text style={[styles.todayText, { color: colors.foreground }]}>{startKey === todayKey ? 'Today' : 'Back to today'}</Text>
          </Pressable>
          <Pressable testID="planner-next-window" accessibilityRole="button" accessibilityLabel="Move planner forward 7 days" onPress={() => setStartKey((current) => shiftPlannerDate(current, 7))} style={({ pressed }) => [styles.navButton, { borderColor: colors.border, backgroundColor: colors.card, opacity: pressed ? 0.72 : 1 }]}>
            <Feather name="chevron-right" size={20} color={colors.foreground} />
          </Pressable>
        </View>
        <View style={styles.viewFilters}>
          {(['Open', 'All'] as const).map((option) => (
            <Pressable key={option} testID={`planner-view-${option.toLowerCase()}`} accessibilityRole="button" accessibilityLabel={`${option} planner tasks`} accessibilityState={{ selected: view === option }} onPress={() => setView(option)} style={({ pressed }) => [styles.viewFilter, { borderColor: colors.border, opacity: pressed ? 0.75 : 1 }, view === option && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
              <Text style={[styles.viewFilterText, { color: view === option ? colors.primaryForeground : colors.mutedForeground }]}>{option}</Text>
            </Pressable>
          ))}
          <Text style={[styles.taskCount, { color: colors.mutedForeground }]}>{agendaTaskCount} {view === 'Open' ? 'open' : 'visible'} tasks</Text>
        </View>
      </View>

      {message ? (
        <Pressable testID="planner-message" accessibilityRole="button" accessibilityLabel="Dismiss planner notification" onPress={() => setMessage('')} style={[styles.message, { backgroundColor: colors.secondary }]}>
          <Text style={[styles.messageText, { color: colors.secondaryForeground }]}>{message}</Text>
          <Feather name="x" size={16} color={colors.mutedForeground} />
        </Pressable>
      ) : null}
      {fieldbook.conflicts.length ? (
        <Pressable testID="planner-conflict" accessibilityRole="button" onPress={showConflict} style={[styles.message, { backgroundColor: colors.accent }]}>
          <Feather name="alert-triangle" size={16} color={colors.accentForeground} />
          <Text style={[styles.messageText, { color: colors.accentForeground }]}>A task changed elsewhere. Tap to choose which version to keep.</Text>
        </Pressable>
      ) : null}
      {attachments.uploadStatus ? (
        <View style={[styles.message, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text numberOfLines={1} style={[styles.messageText, { color: colors.foreground }]}>Uploading {attachments.uploadStatus.currentName} · {attachments.uploadStatus.completed}/{attachments.uploadStatus.total}</Text>
        </View>
      ) : null}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Platform.OS === 'web' ? 120 : insets.bottom + 100 }]}
        refreshControl={<RefreshControl refreshing={tasksQuery.isRefetching || fieldbook.syncing} onRefresh={refresh} tintColor={colors.primary} />}
      >
        {agenda.overdue.length ? (
          <View style={[styles.section, { borderColor: colors.destructive, backgroundColor: colors.card }]}>
            <View style={styles.sectionHeader}>
              <View style={[styles.sectionDot, { backgroundColor: colors.destructive }]} />
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Overdue</Text>
              <Text style={[styles.sectionCount, { color: colors.mutedForeground }]}>{agenda.overdue.length}</Text>
            </View>
            <View style={styles.taskList}>
              {agenda.overdue.map((task) => <PlannerTaskCard key={task.id} task={task} onToggle={toggle} onOpen={setDetailTask} onCycleUrgency={canManage ? cycleUrgency : undefined} onAttach={canManage ? handleAttach : undefined} onOpenAttachment={handleOpenAttachment} onDeleteAttachment={canManage ? handleDeleteAttachment : undefined} deletingAttachment={attachments.deleting} />)}
            </View>
          </View>
        ) : null}

        {agenda.days.filter((day) => day.tasks.length > 0).map((day) => (
          <View key={day.dateKey} testID={`planner-day-${day.dateKey}`} style={[styles.section, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <View style={styles.sectionHeader}>
              <View style={[styles.sectionDot, { backgroundColor: day.dateKey === todayKey ? colors.primary : colors.accent }]} />
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{plannerDateLabel(day.dateKey, todayKey)}</Text>
              <Text style={[styles.sectionCount, { color: colors.mutedForeground }]}>{day.tasks.length}</Text>
            </View>
            <View style={styles.taskList}>
              {day.tasks.map((task) => <PlannerTaskCard key={task.id} task={task} onToggle={toggle} onOpen={setDetailTask} onCycleUrgency={canManage ? cycleUrgency : undefined} onAttach={canManage ? handleAttach : undefined} onOpenAttachment={handleOpenAttachment} onDeleteAttachment={canManage ? handleDeleteAttachment : undefined} deletingAttachment={attachments.deleting} />)}
            </View>
          </View>
        ))}

        {agenda.unscheduled.length ? (
          <View style={[styles.section, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <View style={styles.sectionHeader}>
              <View style={[styles.sectionDot, { backgroundColor: colors.mutedForeground }]} />
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>No date assigned</Text>
              <Text style={[styles.sectionCount, { color: colors.mutedForeground }]}>{agenda.unscheduled.length}</Text>
            </View>
            <View style={styles.taskList}>
              {agenda.unscheduled.map((task) => <PlannerTaskCard key={task.id} task={task} onToggle={toggle} onOpen={setDetailTask} onCycleUrgency={canManage ? cycleUrgency : undefined} onAttach={canManage ? handleAttach : undefined} onOpenAttachment={handleOpenAttachment} onDeleteAttachment={canManage ? handleDeleteAttachment : undefined} deletingAttachment={attachments.deleting} />)}
            </View>
          </View>
        ) : null}

        {!hasAgendaTasks ? (
          <View testID="planner-empty" style={styles.empty}>
            <Feather name="calendar" size={30} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No {view === 'Open' ? 'open ' : ''}work in this window</Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Try another 30-day window or pull down to refresh your fieldbook.</Text>
          </View>
        ) : null}
      </ScrollView>

      <TaskDetailsSheet
        task={accountScope ? detailTask : undefined}
        visible={Boolean(accountScope && detailTask)}
        onClose={() => setDetailTask(undefined)}
        onEdit={canManage ? (task) => { setDetailTask(undefined); setEditingTask(task); } : undefined}
        onOpenAttachment={handleOpenAttachment}
      />
      <QuickTaskSheet
        visible={Boolean(accountScope && editingTask)}
        task={accountScope ? editingTask : undefined}
        saving={fieldbook.syncing}
        onClose={() => setEditingTask(undefined)}
        groups={TASK_CATEGORIES}
        months={availableMonths}
        workers={workersQuery.data ?? []}
        canAssign={canManage}
        onUpdate={handleUpdate}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 18, paddingBottom: 14 },
  headerTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 15 },
  headerCopy: { flex: 1 },
  kicker: { fontSize: 11, letterSpacing: 1.4, fontWeight: '800', marginBottom: 5 },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { fontSize: 13, marginTop: 4, lineHeight: 18 },
  syncStatus: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 99, marginTop: 5 },
  syncText: { fontSize: 11, fontWeight: '700' },
  navigation: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  navButton: { width: 42, height: 42, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  todayButton: { flex: 1, minHeight: 42, borderWidth: 1, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  todayText: { fontSize: 14, fontWeight: '800' },
  viewFilters: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  viewFilter: { minWidth: 76, minHeight: 38, borderWidth: 1, borderRadius: 99, paddingHorizontal: 15, alignItems: 'center', justifyContent: 'center' },
  viewFilterText: { fontSize: 13, fontWeight: '800' },
  taskCount: { flex: 1, textAlign: 'right', fontSize: 11, fontWeight: '700' },
  message: { marginHorizontal: 18, marginBottom: 10, minHeight: 44, borderRadius: 13, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 9 },
  messageText: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 18, gap: 14 },
  section: { borderWidth: 1, borderRadius: 17, padding: 10, gap: 9 },
  sectionHeader: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  sectionDot: { width: 8, height: 8, borderRadius: 4 },
  sectionTitle: { flex: 1, fontSize: 15, fontWeight: '800' },
  sectionCount: { fontSize: 12, fontWeight: '800' },
  taskList: { gap: 9 },
  empty: { alignItems: 'center', justifyContent: 'center', minHeight: 260, paddingHorizontal: 24, gap: 9 },
  emptyTitle: { fontSize: 19, fontWeight: '800', textAlign: 'center' },
  emptyText: { maxWidth: 280, fontSize: 14, lineHeight: 20, textAlign: 'center' },
});