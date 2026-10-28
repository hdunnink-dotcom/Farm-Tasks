import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getListFarmTasksQueryKey,
  customFetch,
  type FarmTask,
  type TaskInput,
  useDeleteFarmTask,
  useListFarmTasks,
} from '@workspace/api-client-react';
import { PlannerTaskCard } from '@/components/PlannerTaskCard';
import { StartupStatus } from '@/components/StartupStatus';
import { TaskDetailsSheet } from '@/components/TaskDetailsSheet';
import { QuickTaskSheet } from '@/components/QuickTaskSheet';
import { TaskMapSheet } from '@/components/TaskMapSheet';
import { useColors } from '@/hooks/useColors';
import { CURRENT_MONTH, localMonthKey, monthLabel, monthOptions } from '@/lib/task-month';
import { type LocalAttachment } from '@/components/AttachmentPicker';
import { useFarmTaskAttachments } from '@/hooks/useFarmTaskAttachments';
import { useMobileFieldbook, useMobileTaskViewPreferences } from '@/hooks/useMobileFieldbook';
import { TASK_CATEGORIES } from '@/lib/task-categories';
import { useAccountIdentity } from '@/hooks/useAccountIdentity';
import { addLocalWeeks, calendarPeriodLabel, startOfLocalWeek, taskMatchesCalendarPeriod } from '@/lib/task-calendar';
import { sortTasksForList } from '@/lib/task-sort';
import { taskAssignedTo } from '@/lib/task-assignment';

type Member = { clerkId: string; role: string; isHarnold?: boolean };
type Worker = { clerkId: string; displayName: string; status: string };

export default function TasksScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const activeIdentity = useAccountIdentity();
  const [detailTask, setDetailTask] = useState<FarmTask>();
  const [editingTask, setEditingTask] = useState<FarmTask>();
  const [mapOpen, setMapOpen] = useState(false);
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
  const workersQuery = useQuery({
    queryKey: ['/api/team', accountScope],
    queryFn: () => customFetch<Worker[]>('/api/team'),
    enabled: Boolean(accountScope && (isOwner || isHarnold)),
  });
  const taskView = useMobileTaskViewPreferences(accountScope);
  const { preferences, updatePreferences } = taskView;
  const tasksQuery = useListFarmTasks({ includeDone: true }, { query: { queryKey: [...getListFarmTasksQueryKey({ includeDone: true }), accountScope], enabled: Boolean(accountScope), staleTime: 30_000 } });
  const fieldbook = useMobileFieldbook(accountScope, tasksQuery.data?.tasks, tasksQuery.isSuccess || tasksQuery.isError);
  const deleteTask = useDeleteFarmTask({
    mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: [...getListFarmTasksQueryKey({ includeDone: true }), accountScope] }) },
  });
  const scopedTasks = accountScope
    ? (tasksQuery.data?.tasks ?? (fieldbook.readyForScope ? fieldbook.tasks : []))
    : [];
  const all = isOwner || isHarnold || !accountScope
    ? scopedTasks
    : scopedTasks.filter((task) => taskAssignedTo(task, accountScope));
  const groups = TASK_CATEGORIES;
  const availableMonths = useMemo(() => monthOptions(all), [all]);
  const periodLabel = calendarPeriodLabel(preferences.calendarScope, preferences.monthFilter, preferences.weekFilter, preferences.weekStart, monthLabel, localMonthKey());
  const matchesPeriod = (task: FarmTask) => taskMatchesCalendarPeriod(task, preferences.calendarScope, preferences.monthFilter, preferences.weekFilter, preferences.weekStart);
  const tasks = useMemo(
    () => sortTasksForList(all.filter((task) => (preferences.view === 'All' || (preferences.view === 'Done' ? task.done : !task.done)) && matchesPeriod(task)), preferences.sort),
    [all, preferences],
  );
  const mapTasks = useMemo(() => all.filter((task) => !task.done && matchesPeriod(task)), [all, preferences]);
  const navigateMonth = (amount: number) => {
    const base = preferences.monthFilter.match(/^(\d{4})-(\d{2})$/);
    const date = base ? new Date(Number(base[1]), Number(base[2]) - 1 + amount, 1) : new Date(new Date().getFullYear(), new Date().getMonth() + amount, 1);
    updatePreferences({ monthFilter: localMonthKey(date) });
  };
  const optimisticallyUpdateTask = (taskId: string, patch: Partial<FarmTask>) => {
    queryClient.setQueryData<{ tasks: FarmTask[] }>([...getListFarmTasksQueryKey({ includeDone: true }), accountScope], (current) => {
      if (!current?.tasks) return current;
      return { ...current, tasks: current.tasks.map((item) => item.id === taskId ? { ...item, ...patch } : item) };
    });
  };

  useEffect(() => {
    setDetailTask(undefined);
    setEditingTask(undefined);
    setMapOpen(false);
  }, [activeIdentity]);

  const toggle = (task: FarmTask) => {
    const done = !task.done;
    Alert.alert(done ? 'Mark task complete?' : 'Reopen task?', task.task, [
      { text: 'Cancel', style: 'cancel' },
      { text: done ? 'Mark complete' : 'Reopen', style: 'default', onPress: () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        void fieldbook.saveTask(task, { task: task.task, done }).catch(() => optimisticallyUpdateTask(task.id, { done: task.done }));
      } },
    ]);
  };
  const cycleUrgency = (task: FarmTask) => {
    const order: FarmTask['urgency'][] = ['Urgent', 'High', 'Medium', 'Low'];
    const next = order[(order.indexOf(task.urgency) + 1) % order.length];
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void fieldbook.saveTask(task, { task: task.task, urgency: next }).catch(() => optimisticallyUpdateTask(task.id, { urgency: task.urgency }));
  };
  const remove = (task: FarmTask) => {
    Alert.alert('Remove task?', `Remove “${task.task}” from the shared sheet?`, [
      { text: 'Keep', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => deleteTask.mutate({ taskId: task.id }) },
    ]);
  };
  const uploadAttachments = async (taskId: string, files: LocalAttachment[]) => {
    const result = await attachments.upload(taskId, files);
    if (result.failed.length) Alert.alert('Some attachments could not upload', result.failed.join('\n'));
  };
  const handleAttach = (task: FarmTask, files: LocalAttachment[]) => {
    void uploadAttachments(task.id, files);
  };
  const handleDeleteAttachment = (attachmentId: string) => {
    Alert.alert('Remove attachment?', 'This permanently removes the protected file from this task.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => { void attachments.remove(attachmentId).catch((error) => Alert.alert('Could not remove attachment', error instanceof Error ? error.message : 'Please try again.')); } },
    ]);
  };
  const handleOpenAttachment = (attachmentId: string) => {
    void attachments.open(attachmentId).catch((error) => Alert.alert('Could not open attachment', error instanceof Error ? error.message : 'Please try again.'));
  };
  const handleUpdate = (taskId: string, data: TaskInput) => {
    const task = all.find((item) => item.id === taskId) ?? editingTask;
    if (!task) return;
    optimisticallyUpdateTask(taskId, data);
    void fieldbook.saveTask(task, data).then(() => {
      setEditingTask(undefined);
      setDetailTask(undefined);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }).catch(() => {
      optimisticallyUpdateTask(taskId, task);
      Alert.alert('Could not save task', 'Please try again when the connection is available.');
    });
  };

  if (memberQuery.isError) {
    return <StartupStatus kind="api" title="Could not verify your account" message="The planner server could not be reached. Check your connection and try again." actionLabel="Retry connection" onAction={() => void memberQuery.refetch()} busy={memberQuery.isRefetching} />;
  }
  if (tasksQuery.isError && !fieldbook.readyForScope) {
    return <StartupStatus kind="api" title="Could not load your tasks" message="The task list did not respond. Check your connection and try again." actionLabel="Retry connection" onAction={() => void tasksQuery.refetch()} busy={tasksQuery.isRefetching} />;
  }
  if (memberQuery.isLoading || !accountScope || (!fieldbook.readyForScope && tasksQuery.isLoading) || !taskView.readyForScope || !fieldbook.readyForScope) {
    return <StartupStatus kind="loading" title="Loading your work" message="The planner is preparing your task list." />;
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.foreground }]}>All work</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Everything in the shared farm sheet.</Text>
      </View>
      <View style={styles.filters}>
        {(['Open', 'All', 'Done'] as const).map((item) => (
          <Pressable
            key={item}
             testID={`task-view-${item.toLowerCase()}`}
             accessibilityRole="button"
             accessibilityState={{ selected: preferences.view === item }}
             accessibilityLabel={`${item === 'Open' ? 'Open work' : item === 'All' ? 'Everything' : 'Completed'} tasks`}
             onPress={() => updatePreferences({ view: item })}
             style={({ pressed }) => [styles.filter, { borderColor: colors.border, opacity: pressed ? 0.75 : 1 }, preferences.view === item && { backgroundColor: colors.primary, borderColor: colors.primary }]}
          >
             <Text style={[styles.filterText, { color: preferences.view === item ? colors.primaryForeground : colors.mutedForeground }]}>{item}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.monthSection}>
        <Text style={[styles.filterLabel, { color: colors.mutedForeground }]}>Calendar</Text>
        <View style={styles.scopeFilters}>
          {(['month', 'week'] as const).map((scope) => (
            <Pressable key={scope} testID={`calendar-scope-${scope}`} accessibilityRole="button" accessibilityState={{ selected: preferences.calendarScope === scope }} accessibilityLabel={`Show tasks by ${scope}`} onPress={() => updatePreferences({ calendarScope: scope })} style={({ pressed }) => [styles.filter, { borderColor: colors.border, opacity: pressed ? 0.75 : 1 }, preferences.calendarScope === scope && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
              <Text style={[styles.filterText, { color: preferences.calendarScope === scope ? colors.primaryForeground : colors.mutedForeground }]}>{scope === 'month' ? 'Month' : 'Week'}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.periodNavigation}>
           <Pressable accessibilityRole="button" accessibilityLabel={`Previous ${preferences.calendarScope}`} onPress={() => preferences.calendarScope === 'month' ? navigateMonth(-1) : updatePreferences({ weekStart: addLocalWeeks(preferences.weekStart, -1) })} style={({ pressed }) => [styles.periodButton, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}><Feather name="chevron-left" size={18} color={colors.foreground} /></Pressable>
          <View style={styles.periodCopy}>
            <Text style={[styles.activePeriod, { color: colors.foreground }]}>{periodLabel}</Text>
             <Pressable accessibilityRole="button" accessibilityLabel={`Show current ${preferences.calendarScope}`} onPress={() => preferences.calendarScope === 'month' ? updatePreferences({ monthFilter: CURRENT_MONTH }) : updatePreferences({ weekStart: startOfLocalWeek() })}>
              <Text style={[styles.currentPeriod, { color: colors.primary }]}>Current {preferences.calendarScope}</Text>
            </Pressable>
          </View>
           <Pressable accessibilityRole="button" accessibilityLabel={`Next ${preferences.calendarScope}`} onPress={() => preferences.calendarScope === 'month' ? navigateMonth(1) : updatePreferences({ weekStart: addLocalWeeks(preferences.weekStart, 1) })} style={({ pressed }) => [styles.periodButton, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}><Feather name="chevron-right" size={18} color={colors.foreground} /></Pressable>
        </View>
        {preferences.calendarScope === 'month' ? (
          <View style={styles.monthFilters}>
            {[
              ['all', 'All months'],
              [CURRENT_MONTH, 'Current month'],
              ['unscheduled', 'Unscheduled'],
              ...availableMonths.map((month) => [month, monthLabel(month)]),
            ].map(([value, label]) => (
               <Pressable key={value} testID={`month-filter-${value}`} accessibilityRole="button" accessibilityState={{ selected: preferences.monthFilter === value }} accessibilityLabel={`Filter by ${label}`} onPress={() => updatePreferences({ monthFilter: value })} style={({ pressed }) => [styles.monthFilter, { borderColor: colors.border, opacity: pressed ? 0.75 : 1 }, preferences.monthFilter === value && { backgroundColor: colors.secondary, borderColor: colors.primary }]}>
                <Text style={[styles.monthFilterText, { color: preferences.monthFilter === value ? colors.primary : colors.mutedForeground }]}>{label}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <View style={styles.monthFilters}>
             <Pressable testID="week-filter-scheduled" accessibilityRole="button" accessibilityState={{ selected: preferences.weekFilter === 'week' }} accessibilityLabel="Filter scheduled this week" onPress={() => updatePreferences({ weekFilter: 'week' })} style={({ pressed }) => [styles.monthFilter, { borderColor: colors.border, opacity: pressed ? 0.75 : 1 }, preferences.weekFilter === 'week' && { backgroundColor: colors.secondary, borderColor: colors.primary }]}><Text style={[styles.monthFilterText, { color: preferences.weekFilter === 'week' ? colors.primary : colors.mutedForeground }]}>Scheduled this week</Text></Pressable>
             <Pressable testID="week-filter-unscheduled" accessibilityRole="button" accessibilityState={{ selected: preferences.weekFilter === 'unscheduled' }} accessibilityLabel="Filter unscheduled tasks" onPress={() => updatePreferences({ weekFilter: 'unscheduled' })} style={({ pressed }) => [styles.monthFilter, { borderColor: colors.border, opacity: pressed ? 0.75 : 1 }, preferences.weekFilter === 'unscheduled' && { backgroundColor: colors.secondary, borderColor: colors.primary }]}><Text style={[styles.monthFilterText, { color: preferences.weekFilter === 'unscheduled' ? colors.primary : colors.mutedForeground }]}>Unscheduled</Text></Pressable>
          </View>
        )}
        <View style={styles.sortRow}>
          <Text style={[styles.filterLabel, { color: colors.mutedForeground }]}>Sort</Text>
          <View style={styles.sortFilters}>
            {([
              ['priority', 'Priority'],
              ['date', 'Date'],
              ['title', 'Title'],
              ['updated', 'Recently updated'],
            ] as const).map(([value, label]) => (
               <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: preferences.sort === value }} accessibilityLabel={`Sort by ${label}`} onPress={() => updatePreferences({ sort: value })} style={({ pressed }) => [styles.monthFilter, { borderColor: colors.border, opacity: pressed ? 0.75 : 1 }, preferences.sort === value && { backgroundColor: colors.secondary, borderColor: colors.primary }]}><Text style={[styles.monthFilterText, { color: preferences.sort === value ? colors.primary : colors.mutedForeground }]}>{label}</Text></Pressable>
            ))}
          </View>
        </View>
         <Pressable testID="open-all-tasks-map" accessibilityRole="button" accessibilityLabel={`Open map of open tasks for ${periodLabel}`} onPress={() => setMapOpen(true)} style={({ pressed }) => [styles.mapAction, { borderColor: colors.border, backgroundColor: colors.secondary, opacity: pressed ? 0.78 : 1 }]}>
          <Feather name="map" size={16} color={colors.primary} />
          <Text style={[styles.mapActionText, { color: colors.primary }]}>Map open tasks for {periodLabel}</Text>
        </Pressable>
      </View>
      {attachments.uploadStatus ? (
        <View style={[styles.uploadBanner, { backgroundColor: colors.card, borderColor: colors.border }]} accessibilityLiveRegion="polite">
          <View style={styles.uploadBannerTop}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text numberOfLines={1} style={[styles.uploadText, { color: colors.foreground }]}>Uploading {attachments.uploadStatus.currentName}</Text>
            <Text style={[styles.uploadCount, { color: colors.mutedForeground }]}>{attachments.uploadStatus.completed}/{attachments.uploadStatus.total}</Text>
          </View>
          <View style={[styles.progressTrack, { backgroundColor: colors.muted }]}><View style={[styles.progressFill, { backgroundColor: colors.primary, width: `${attachments.uploadStatus.currentProgress}%` }]} /></View>
        </View>
      ) : null}
      <FlatList
        data={tasks}
        keyExtractor={(task) => task.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={tasksQuery.isRefetching} onRefresh={() => tasksQuery.refetch()} tintColor={colors.primary} />}
          renderItem={({ item }) => <PlannerTaskCard task={item} onToggle={toggle} onOpen={setDetailTask} onDelete={remove} onCycleUrgency={cycleUrgency} onAttach={handleAttach} onOpenAttachment={handleOpenAttachment} onDeleteAttachment={handleDeleteAttachment} deletingAttachment={attachments.deleting} />}
          ListEmptyComponent={<View style={styles.empty}><Feather name="wind" size={28} color={colors.mutedForeground} /><Text style={[styles.emptyTitle, { color: colors.foreground }]}>No work for {periodLabel}</Text><Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Try another period, view, or add a new task from Today.</Text></View>}
      />
      <TaskDetailsSheet task={accountScope ? detailTask : undefined} visible={Boolean(accountScope && detailTask)} onClose={() => setDetailTask(undefined)} onEdit={(task) => { setDetailTask(undefined); setEditingTask(task); }} onOpenAttachment={handleOpenAttachment} />
      <QuickTaskSheet visible={Boolean(accountScope && editingTask)} task={accountScope ? editingTask : undefined} saving={false} onClose={() => setEditingTask(undefined)} groups={groups} months={availableMonths} workers={workersQuery.data ?? []} canAssign={isOwner || isHarnold} onUpdate={handleUpdate} />
      <TaskMapSheet visible={Boolean(accountScope && mapOpen)} tasks={mapTasks} monthLabel={periodLabel} onClose={() => setMapOpen(false)} onOpenTask={(task) => { setMapOpen(false); setDetailTask(task); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 18 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { paddingTop: 16, marginBottom: 15 },
  title: { fontSize: 28, fontWeight: '800' },
  subtitle: { fontSize: 14, marginTop: 4 },
  filters: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  scopeFilters: { flexDirection: 'row', gap: 8, marginBottom: 9 },
  filter: { minWidth: 66, borderWidth: 1, borderRadius: 99, paddingVertical: 8, paddingHorizontal: 13, alignItems: 'center' },
  filterText: { fontSize: 13, fontWeight: '700' },
  monthSection: { marginBottom: 12 },
  filterLabel: { fontSize: 11, fontWeight: '700', marginBottom: 7 },
  monthFilters: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  periodNavigation: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  periodButton: { width: 38, height: 38, borderWidth: 1, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  periodCopy: { flex: 1, alignItems: 'center', gap: 2 },
  activePeriod: { fontSize: 15, fontWeight: '800', textAlign: 'center' },
  currentPeriod: { fontSize: 11, fontWeight: '800' },
  sortRow: { marginTop: 12 },
  sortFilters: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  mapAction: { minHeight: 42, marginTop: 10, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  mapActionText: { fontSize: 12, fontWeight: '800' },
  monthFilter: { borderWidth: 1, borderRadius: 99, paddingVertical: 7, paddingHorizontal: 10 },
  monthFilterText: { fontSize: 11, fontWeight: '700' },
  list: { gap: 10, paddingBottom: 116 },
  empty: { alignItems: 'center', paddingTop: 80, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '800' },
  emptyText: { fontSize: 14, textAlign: 'center', maxWidth: 230, lineHeight: 20 },
  uploadBanner: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 8, marginBottom: 10 },
  uploadBannerTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  uploadText: { flex: 1, fontSize: 12, fontWeight: '700' },
  uploadCount: { fontSize: 11, fontWeight: '700' },
  progressTrack: { height: 5, borderRadius: 99, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 99 },
});