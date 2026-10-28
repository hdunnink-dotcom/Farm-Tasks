import { Feather } from '@expo/vector-icons';
import { Alert, Modal, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { type FarmTask } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { coordinateLabel, googleMapsUrl, hasCoordinates, isSafeExternalUrl } from '@/lib/task-location';
import { taskAssigneeNames } from '@/lib/task-assignment';

type Props = {
  task?: FarmTask;
  visible: boolean;
  onClose: () => void;
  onEdit?: (task: FarmTask) => void;
  onOpenAttachment?: (attachmentId: string) => void;
};

export function TaskDetailsSheet({ task, visible, onClose, onEdit, onOpenAttachment }: Props) {
  const colors = useColors();
  if (!task) return null;
  const mapsUrl = googleMapsUrl(task);
  const assigneeNames = taskAssigneeNames(task);
  const openUrl = async (url: string, name: string) => {
    if (!isSafeExternalUrl(url)) {
      Alert.alert(`Invalid ${name} link`, 'Please edit this task and use a complete http or https link.');
      return;
    }
    const supported = await Linking.canOpenURL(url);
    if (!supported) {
      Alert.alert(`Could not open ${name}`, 'No app on this device can open this link.');
      return;
    }
    await Linking.openURL(url);
  };

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.scrim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: colors.card }]}>
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />
          <View style={styles.heading}>
            <View style={styles.headingCopy}>
              <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>TASK · OVERVIEW</Text>
              <Text style={[styles.title, { color: colors.foreground }]}>{task.task}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close task details">
              <Feather name="x" size={22} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.metaGrid}>
              <Meta label="Group" value={task.group || 'General'} colors={colors} />
              <Meta label="Priority" value={task.urgency} colors={colors} />
              {task.location ? <Meta label="Location" value={task.location} colors={colors} /> : null}
              {hasCoordinates(task) ? <Meta label="GPS pin" value={coordinateLabel(task)} colors={colors} /> : null}
              {task.month ? <Meta label="Month" value={task.month} colors={colors} /> : null}
              <Meta label="Assigned team" value={assigneeNames.length ? assigneeNames.join(', ') : 'Unassigned'} colors={colors} />
            </View>

            {task.notes ? (
              <Section label="Notes" colors={colors}>
                <Text style={[styles.body, { color: colors.foreground }]}>{task.notes}</Text>
              </Section>
            ) : null}

            <Section label={`Steps · ${task.subtasks.filter((step) => step.done).length}/${task.subtasks.length}`} colors={colors}>
              {task.subtasks.length ? task.subtasks.map((step) => (
                <View key={step.id} style={styles.step}>
                  <View style={[styles.stepIcon, { borderColor: step.done ? colors.primary : colors.border, backgroundColor: step.done ? colors.primary : 'transparent' }]}>
                    {step.done ? <Feather name="check" size={13} color={colors.primaryForeground} /> : null}
                  </View>
                  <Text style={[styles.stepText, { color: step.done ? colors.mutedForeground : colors.foreground }, step.done && styles.doneText]}>{step.title}</Text>
                </View>
              )) : <Text style={[styles.muted, { color: colors.mutedForeground }]}>No checklist steps yet.</Text>}
            </Section>

            {task.link ? (
              <Pressable onPress={() => void openUrl(task.link, 'reference')} style={[styles.link, { borderColor: colors.border, backgroundColor: colors.muted }]} accessibilityRole="link">
                <Feather name="external-link" size={16} color={colors.primary} />
                <Text numberOfLines={1} style={[styles.linkText, { color: colors.primary }]}>{task.link}</Text>
              </Pressable>
            ) : null}
            {mapsUrl ? (
              <Pressable testID={`open-task-map-${task.id}`} onPress={() => void openUrl(mapsUrl, 'Google Maps')} style={[styles.link, { borderColor: colors.border, backgroundColor: colors.secondary }]} accessibilityRole="link">
                <Feather name="map-pin" size={16} color={colors.primary} />
                <Text style={[styles.linkText, { color: colors.primary }]}>Open GPS pin in Google Maps</Text>
              </Pressable>
            ) : null}
            {task.atlasLink ? (
              <Pressable testID={`open-task-atlas-${task.id}`} onPress={() => void openUrl(task.atlasLink!, 'Atlas')} style={[styles.link, { borderColor: colors.border, backgroundColor: colors.muted }]} accessibilityRole="link">
                <Feather name="map" size={16} color={colors.primary} />
                <Text numberOfLines={1} style={[styles.linkText, { color: colors.primary }]}>Open shared Atlas map</Text>
              </Pressable>
            ) : null}

            {task.attachments.length ? (
              <Section label="Attachments" colors={colors}>
                {task.attachments.map((attachment) => (
                  <Pressable key={attachment.id} onPress={() => onOpenAttachment?.(attachment.id)} style={[styles.attachment, { borderColor: colors.border, backgroundColor: colors.muted }]} accessibilityRole="link">
                    <Feather name={attachment.contentType.startsWith('image/') ? 'image' : 'file'} size={16} color={colors.primary} />
                    <Text numberOfLines={1} style={[styles.attachmentText, { color: colors.foreground }]}>{attachment.name}</Text>
                    <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
                  </Pressable>
                ))}
              </Section>
            ) : null}

            {onEdit ? <Pressable testID={`edit-task-${task.id}`} onPress={() => onEdit(task)} style={[styles.editButton, { backgroundColor: colors.primary }]} accessibilityRole="button">
              <Feather name="edit-2" size={17} color={colors.primaryForeground} />
              <Text style={[styles.editText, { color: colors.primaryForeground }]}>Edit task</Text>
            </Pressable> : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Meta({ label, value, colors }: { label: string; value: string; colors: ReturnType<typeof useColors> }) {
  return <View style={[styles.meta, { borderColor: colors.border, backgroundColor: colors.muted }]}><Text style={[styles.metaLabel, { color: colors.mutedForeground }]}>{label}</Text><Text numberOfLines={2} style={[styles.metaValue, { color: colors.foreground }]}>{value}</Text></View>;
}

function Section({ label, children, colors }: { label: string; children: React.ReactNode; colors: ReturnType<typeof useColors> }) {
  return <View style={styles.section}><Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>{label}</Text>{children}</View>;
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20, 28, 24, 0.38)' },
  sheet: { maxHeight: '88%', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, paddingBottom: 34 },
  grabber: { width: 42, height: 5, borderRadius: 999, alignSelf: 'center', marginBottom: 18 },
  heading: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  headingCopy: { flex: 1 },
  eyebrow: { fontSize: 11, letterSpacing: 1.4, fontWeight: '800' },
  title: { fontSize: 26, lineHeight: 31, fontWeight: '800', marginTop: 4 },
  content: { gap: 18, paddingTop: 20, paddingBottom: 10 },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  meta: { minWidth: '46%', flexGrow: 1, borderWidth: 1, borderRadius: 12, padding: 10 },
  metaLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  metaValue: { fontSize: 14, fontWeight: '700', marginTop: 4 },
  section: { gap: 9 },
  sectionLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  body: { fontSize: 15, lineHeight: 22 },
  muted: { fontSize: 14 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepIcon: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  stepText: { flex: 1, fontSize: 14, lineHeight: 20 },
  doneText: { textDecorationLine: 'line-through' },
  link: { minHeight: 48, borderWidth: 1, borderRadius: 13, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 9 },
  linkText: { flex: 1, fontSize: 14, fontWeight: '700' },
  attachment: { minHeight: 48, borderWidth: 1, borderRadius: 13, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 9 },
  attachmentText: { flex: 1, fontSize: 14, fontWeight: '600' },
  editButton: { minHeight: 52, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  editText: { fontSize: 16, fontWeight: '800' },
});