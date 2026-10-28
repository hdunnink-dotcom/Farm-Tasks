import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import React, { useMemo, useState, useCallback } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { customFetch, getListFarmTasksQueryKey, useListFarmTasks } from '@workspace/api-client-react';
import { PlannerTaskCard } from '@/components/PlannerTaskCard';
import { StartupStatus } from '@/components/StartupStatus';
import { useColors } from '@/hooks/useColors';
import { useAccountIdentity } from '@/hooks/useAccountIdentity';
import { useMobileFieldbook } from '@/hooks/useMobileFieldbook';
import { useFarmTaskAttachments } from '@/hooks/useFarmTaskAttachments';
import { getStartOfWeek, addWeeks, groupTasks } from '@/lib/week-utils';
import { type FarmTask } from '@workspace/api-client-react';
import { taskAssignedTo } from '@/lib/task-assignment';

type Member = { clerkId: string; role: string };

export default function WeekScreen() {
  const colors = useColors();
  const activeIdentity = useAccountIdentity();
  const memberQuery = useQuery({
    queryKey: ['/api/me', activeIdentity],
    queryFn: () => customFetch<Member>('/api/me'),
    enabled: Boolean(activeIdentity),
  });
  const verifiedMember = memberQuery.data?.clerkId === activeIdentity ? memberQuery.data : null;
  const accountScope = verifiedMember?.clerkId ?? null;
  const isOwner = verifiedMember?.role === 'master';
  const tasksQuery = useListFarmTasks({ includeDone: true }, {
    query: {
      queryKey: [...getListFarmTasksQueryKey({ includeDone: true }), activeIdentity],
      enabled: Boolean(activeIdentity),
      staleTime: 30_000,
    },
  });
  const fieldbook = useMobileFieldbook(accountScope, tasksQuery.data?.tasks ?? [], tasksQuery.isSuccess || tasksQuery.isError);
  const insets = useSafeAreaInsets();
  const attachments = useFarmTaskAttachments();
  
  const [currentWeekStart, setCurrentWeekStart] = useState(() => getStartOfWeek(new Date()));

  const handlePrevWeek = () => setCurrentWeekStart(prev => addWeeks(prev, -1));
  const handleNextWeek = () => setCurrentWeekStart(prev => addWeeks(prev, 1));
  const handleToday = () => setCurrentWeekStart(getStartOfWeek(new Date()));

  const grouped = useMemo(() => {
    const visibleTasks = isOwner || !accountScope
      ? fieldbook.tasks
      : fieldbook.tasks.filter((task) => taskAssignedTo(task, accountScope));
    return groupTasks(visibleTasks, currentWeekStart);
  }, [accountScope, fieldbook.tasks, currentWeekStart, isOwner]);

  const handleToggle = useCallback((task: FarmTask) => {
    fieldbook.saveTask(task, { task: task.task, done: !task.done });
  }, [fieldbook]);

  const handleOpenAttachment = useCallback((attachmentId: string) => {
    void attachments.open(attachmentId).catch((error) => 
      Alert.alert('Could not open attachment', error instanceof Error ? error.message : 'Please try again.')
    );
  }, [attachments]);

  const renderGroup = (title: string, tasks: FarmTask[], showEmpty = false) => {
    if (tasks.length === 0 && !showEmpty) return null;
    
    return (
      <View style={styles.groupContainer}>
        <Text style={[styles.groupTitle, { color: colors.foreground }]}>{title}</Text>
        {tasks.length > 0 ? (
          <View style={styles.taskList}>
            {tasks.map(task => (
              <PlannerTaskCard
                key={task.id}
                task={task}
                onToggle={handleToggle}
                onOpen={() => {}} // No detail editing exposed on this view to prevent reprioritization/reassignment
                onOpenAttachment={handleOpenAttachment}
              />
            ))}
          </View>
        ) : (
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            No tasks in this group.
          </Text>
        )}
      </View>
    );
  };

  const isCurrentWeek = currentWeekStart.getTime() === getStartOfWeek(new Date()).getTime();
  const weekLabel = `Week of ${currentWeekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;

  if (memberQuery.isError) {
    return <StartupStatus kind="api" title="Could not verify your account" message="The planner server could not be reached. Check your connection and try again." actionLabel="Retry connection" onAction={() => void memberQuery.refetch()} busy={memberQuery.isRefetching} />;
  }
  if (memberQuery.isLoading || !accountScope || !fieldbook.readyForScope) {
    return <StartupStatus kind="loading" title="Loading your week" message="The planner is preparing your weekly work." />;
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: Platform.OS === 'web' ? 67 : insets.top + 16 }]}>
        <View style={styles.headerTop}>
          <Text style={[styles.title, { color: colors.foreground }]}>My Week</Text>
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
              {fieldbook.syncing
                ? 'Syncing...'
                : fieldbook.pendingCount > 0
                ? `${fieldbook.pendingCount} pending`
                : fieldbook.online
                ? 'Up to date'
                : 'Offline'}
            </Text>
          </View>
        </View>
        
        <View style={styles.weekNav}>
           <Pressable accessibilityRole="button" accessibilityLabel="Previous week" onPress={handlePrevWeek} style={({ pressed }) => [styles.navButton, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}>
            <Feather name="chevron-left" size={20} color={colors.foreground} />
          </Pressable>
           <Pressable accessibilityRole="button" accessibilityLabel={isCurrentWeek ? 'Current week' : 'Show current week'} onPress={handleToday} style={({ pressed }) => [styles.navDate, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.75 : 1 }]}>
            <Feather name="calendar" size={16} color={colors.primary} />
            <Text style={[styles.navDateText, { color: colors.foreground, fontWeight: isCurrentWeek ? '700' : '500' }]}>
              {isCurrentWeek ? 'This Week' : weekLabel}
            </Text>
          </Pressable>
           <Pressable accessibilityRole="button" accessibilityLabel="Next week" onPress={handleNextWeek} style={({ pressed }) => [styles.navButton, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}>
            <Feather name="chevron-right" size={20} color={colors.foreground} />
          </Pressable>
        </View>
      </View>

      <ScrollView 
        style={styles.scroll} 
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Platform.OS === 'web' ? 120 : insets.bottom + 100 }]}
        refreshControl={
          <RefreshControl 
            refreshing={fieldbook.syncing} 
            onRefresh={fieldbook.refresh} 
            tintColor={colors.primary} 
          />
        }
      >
        <>
            {renderGroup('Overdue', grouped.overdue, false)}
            {renderGroup('Monday', grouped.monday, true)}
            {renderGroup('Tuesday', grouped.tuesday, true)}
            {renderGroup('Wednesday', grouped.wednesday, true)}
            {renderGroup('Thursday', grouped.thursday, true)}
            {renderGroup('Friday', grouped.friday, true)}
            {renderGroup('Saturday', grouped.saturday, true)}
            {renderGroup('Sunday', grouped.sunday, true)}
            {renderGroup('No Date Assigned', grouped['no-date'], false)}
        </>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    paddingHorizontal: 18,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: { fontSize: 28, fontWeight: '800' },
  syncStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 99,
  },
  syncText: { fontSize: 12, fontWeight: '600' },
  weekNav: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  navButton: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 12,
  },
  navDate: {
    flex: 1,
    height: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
  },
  navDateText: { fontSize: 15 },
  scroll: { flex: 1 },
  scrollContent: { padding: 18, gap: 24 },
  loadingState: { padding: 40, alignItems: 'center' },
  groupContainer: { gap: 12 },
  groupTitle: { fontSize: 18, fontWeight: '700' },
  taskList: { gap: 10 },
  emptyText: { fontSize: 14, fontStyle: 'italic' },
});
