import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { type FarmTask } from '@workspace/api-client-react';
import { AttachmentPicker, type LocalAttachment } from '@/components/AttachmentPicker';
import { useColors } from '@/hooks/useColors';
import { hasCoordinates } from '@/lib/task-location';
import { formatAucklandTaskDate } from '@/lib/task-calendar';
import { taskAssigneeNames } from '@/lib/task-assignment';

type Props = {
  task: FarmTask;
  compact?: boolean;
  onToggle: (task: FarmTask) => void;
  onOpen: (task: FarmTask) => void;
  onDelete?: (task: FarmTask) => void;
  onCycleUrgency?: (task: FarmTask) => void;
  onAttach?: (task: FarmTask, files: LocalAttachment[]) => void;
  onDeleteAttachment?: (attachmentId: string) => void;
  onOpenAttachment?: (attachmentId: string) => void;
  deletingAttachment?: boolean;
};

export function PlannerTaskCard({ task, compact = false, onToggle, onOpen, onDelete, onCycleUrgency, onAttach, onDeleteAttachment, onOpenAttachment, deletingAttachment = false }: Props) {
  const colors = useColors();
  const scheduledLabel = formatAucklandTaskDate(task.calendarStart);
  const assigneeNames = taskAssigneeNames(task);
  const urgencyColor =
    task.urgency === 'Urgent'
      ? colors.destructive
      : task.urgency === 'High'
      ? colors.destructive
      : task.urgency === 'Low'
        ? colors.primary
        : colors.accent;

  return (
    <View style={[styles.card, compact && styles.compactCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Pressable
        testID={`task-toggle-${task.id}`}
        accessibilityRole="checkbox"
        accessibilityLabel={`${task.task}, ${task.done ? 'completed' : 'not completed'}`}
        accessibilityState={{ checked: task.done }}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onToggle(task);
        }}
        hitSlop={8}
        style={[
          styles.check,
          { borderColor: task.done ? colors.primary : colors.input },
          task.done && { backgroundColor: colors.primary },
        ]}
      >
        {task.done ? <Feather name="check" size={16} color={colors.primaryForeground} /> : null}
      </Pressable>
      <View style={styles.content}>
        <View style={styles.taskLine}>
          <Pressable testID={`task-${task.id}`} accessibilityRole="button" accessibilityLabel={`Open details for ${task.task}`} onPress={() => onOpen(task)} style={styles.taskToggle}>
            <Text
              style={[
                styles.task,
                { color: colors.foreground },
                task.done && { color: colors.mutedForeground, textDecorationLine: 'line-through' },
              ]}
            >
              {task.task}
            </Text>
          </Pressable>
          <Pressable onPress={() => onCycleUrgency?.(task)} disabled={!onCycleUrgency} accessibilityRole="button" accessibilityLabel={`Priority ${task.urgency}. Tap to change priority.`} style={({ pressed }) => [styles.urgency, { backgroundColor: `${urgencyColor}1A`, opacity: pressed ? 0.72 : 1 }]}>
            <View style={[styles.dot, { backgroundColor: urgencyColor }]} />
            <Text style={[styles.urgencyText, { color: urgencyColor }]}>{task.urgency}</Text>
          </Pressable>
        </View>
        <Pressable testID={`task-details-${task.id}`} onPress={() => onOpen(task)} accessibilityRole="button" accessibilityLabel={`Open details for ${task.task}`}>
          <View style={styles.meta}>
            {task.location ? (
              <View style={styles.metaItem}>
                <Feather name="map-pin" size={13} color={colors.mutedForeground} />
                <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{task.location}</Text>
              </View>
            ) : null}
            {hasCoordinates(task) ? (
              <View style={styles.metaItem}>
                <Feather name="navigation" size={13} color={colors.primary} />
                <Text style={[styles.metaText, { color: colors.primary }]}>GPS pin</Text>
              </View>
            ) : null}
            {scheduledLabel ? (
              <View style={styles.metaItem}>
                <Feather name="calendar" size={13} color={colors.primary} />
                <Text style={[styles.metaText, { color: colors.primary }]}>{scheduledLabel}</Text>
              </View>
            ) : task.month ? (
              <View style={styles.metaItem}>
                <Feather name="calendar" size={13} color={colors.mutedForeground} />
                <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{task.month}</Text>
              </View>
            ) : null}
            {task.subtasks.length ? (
              <View style={styles.metaItem}>
                <Feather name="list" size={13} color={colors.mutedForeground} />
                <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                  {task.subtasks.length} steps
                </Text>
              </View>
            ) : null}
            {assigneeNames.length ? (
              <View style={styles.metaItem}>
                <Feather name="users" size={13} color={colors.mutedForeground} />
                <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{assigneeNames.join(', ')}</Text>
              </View>
            ) : null}
          </View>
        </Pressable>
        {!compact ? <View style={styles.attachmentActions}>
          {task.attachments.length ? (
            <View style={styles.attachments}>
              <View style={styles.attachmentLabel}>
                <Feather name="paperclip" size={13} color={colors.mutedForeground} />
                <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{task.attachments.length} {task.attachments.length === 1 ? 'attachment' : 'attachments'}</Text>
              </View>
              {task.attachments.map((attachment) => (
                <View key={attachment.id} style={[styles.attachment, { borderColor: colors.border, backgroundColor: colors.muted }]}>
                  <Pressable
                    testID={`task-attachment-${attachment.id}`}
                    accessibilityRole="link"
                    accessibilityLabel={`Open ${attachment.name}`}
                    onPress={() => onOpenAttachment?.(attachment.id)}
                    style={styles.attachmentOpen}
                  >
                    <Feather name={attachment.contentType.startsWith('image/') ? 'image' : 'file'} size={14} color={colors.primary} />
                    <Text numberOfLines={1} style={[styles.attachmentName, { color: colors.foreground }]}>{attachment.name}</Text>
                  </Pressable>
                  {onDeleteAttachment ? (
                    <Pressable
                      testID={`task-attachment-delete-${attachment.id}`}
                      accessibilityLabel={`Delete ${attachment.name}`}
                      disabled={deletingAttachment}
                      onPress={() => onDeleteAttachment(attachment.id)}
                      hitSlop={8}
                    >
                      <Feather name="trash-2" size={14} color={colors.mutedForeground} />
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}
          {onAttach ? <AttachmentPicker compact onPicked={(files) => onAttach(task, files)} /> : null}
        </View> : null}
      </View>
      {onDelete ? (
        <Pressable
          testID={`task-delete-${task.id}`}
          accessibilityLabel={`Delete ${task.task}`}
          onPress={() => onDelete(task)}
          hitSlop={10}
          style={styles.delete}
        >
          <Feather name="trash-2" size={16} color={colors.mutedForeground} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 16,
    flexDirection: 'row',
    gap: 12,
    padding: 14,
    alignItems: 'flex-start',
  },
  compactCard: {
    borderWidth: 0,
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 10,
  },
  check: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  content: { flex: 1, gap: 7 },
  taskLine: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' },
  taskToggle: { flex: 1, minHeight: 44, justifyContent: 'center' },
  task: { fontSize: 16, fontWeight: '700', flex: 1, lineHeight: 22 },
  urgency: { borderRadius: 99, paddingHorizontal: 8, paddingVertical: 4, flexDirection: 'row', gap: 5, alignItems: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  urgencyText: { fontSize: 11, fontWeight: '700' },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 12, fontWeight: '500' },
  attachments: { gap: 6 },
  attachmentActions: { gap: 7 },
  attachmentLabel: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  attachment: { minHeight: 34, borderWidth: 1, borderRadius: 10, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 8 },
  attachmentOpen: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 7 },
  attachmentName: { flex: 1, fontSize: 12, fontWeight: '600' },
  delete: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});