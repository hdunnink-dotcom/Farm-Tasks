import { Feather } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { type FarmTask, type TaskCategory, type TaskInput, type TaskRecurrence } from '@workspace/api-client-react';
import { AttachmentPicker, type LocalAttachment } from '@/components/AttachmentPicker';
import { useColors } from '@/hooks/useColors';
import { monthChoices, monthLabel } from '@/lib/task-month';
import { formatCoordinatePair, parseCoordinatePair } from '@/lib/coordinates';
import { calendarDateKey, calendarMonthDays, calendarMonthLabel, parseAucklandDateTimeInput, shiftCalendarMonth } from '@/lib/task-calendar';
import { taskAssigneeIds, taskAssigneeNames, withTeamAssignment } from '@/lib/task-assignment';

type Worker = { clerkId: string; displayName: string; status: string };
type Props = {
  visible: boolean;
  saving?: boolean;
  onClose: () => void;
  onCreate?: (task: TaskInput, attachments: LocalAttachment[]) => void;
  onUpdate?: (taskId: string, task: TaskInput) => void;
  task?: FarmTask;
  groups: readonly TaskCategory[];
  months: string[];
  workers?: Worker[];
  canAssign?: boolean;
  locations?: readonly string[];
  defaultGroup?: TaskCategory;
  defaultUrgency?: TaskInput['urgency'];
  defaultLocation?: string;
};

export function QuickTaskSheet({ visible, saving, onClose, onCreate, onUpdate, task: editingTask, groups, months, workers = [], canAssign = false, locations = [], defaultGroup = 'Orchards', defaultUrgency = 'Medium', defaultLocation = '' }: Props) {
  const colors = useColors();
  const [task, setTask] = useState('');
  const [group, setGroup] = useState<TaskCategory>(defaultGroup);
  const [urgency, setUrgency] = useState<TaskInput['urgency']>(defaultUrgency);
  const [month, setMonth] = useState('');
  const [location, setLocation] = useState(defaultLocation);
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [coordinateText, setCoordinateText] = useState('');
  const [locationCapturedAt, setLocationCapturedAt] = useState<string | null>(null);
  const [atlasLink, setAtlasLink] = useState('');
  const [locationStatus, setLocationStatus] = useState('');
  const [capturingLocation, setCapturingLocation] = useState(false);
  const [notes, setNotes] = useState('');
  const [subtasksText, setSubtasksText] = useState('');
  const [link, setLink] = useState('');
  const [calendarStart, setCalendarStart] = useState('');
  const [recurrence, setRecurrence] = useState<TaskRecurrence>('none');
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [assigneeNames, setAssigneeNames] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const selectableMonths = monthChoices(months);
  const isEditing = Boolean(editingTask);

  useEffect(() => {
    if (!visible) return;
    setTask(editingTask?.task ?? '');
    setGroup(editingTask?.group || defaultGroup);
    setUrgency(editingTask?.urgency ?? defaultUrgency);
    setMonth(editingTask?.month ?? '');
    setLocation(editingTask?.location ?? defaultLocation);
    setLatitude(editingTask?.latitude ?? null);
    setLongitude(editingTask?.longitude ?? null);
    setCoordinateText(formatCoordinatePair(editingTask?.latitude, editingTask?.longitude));
    setLocationCapturedAt(editingTask?.locationCapturedAt ?? null);
    setAtlasLink(editingTask?.atlasLink ?? '');
    setLocationStatus('');
    setNotes(editingTask?.notes ?? '');
    setSubtasksText((editingTask?.subtasks ?? []).map((step) => step.title).join('\n'));
    setLink(editingTask?.link ?? '');
    setCalendarStart(editingTask?.calendarStart ?? '');
    setRecurrence(editingTask?.recurrence ?? (editingTask?.repeatWeekly ? 'weekly' : 'none'));
    setAssigneeIds(editingTask ? taskAssigneeIds(editingTask) : []);
    setAssigneeNames(editingTask ? taskAssigneeNames(editingTask) : []);
    setAttachments([]);
  }, [visible, editingTask?.id, defaultGroup, defaultUrgency, defaultLocation]);

  const captureCurrentLocation = async () => {
    setCapturingLocation(true);
    setLocationStatus('');
    try {
      const existing = await Location.getForegroundPermissionsAsync();
      const permission = existing.granted ? existing : await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setLocationStatus('Location permission was not granted. You can still enter a block name manually.');
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setLatitude(Number(position.coords.latitude.toFixed(6)));
      setLongitude(Number(position.coords.longitude.toFixed(6)));
      setCoordinateText(formatCoordinatePair(position.coords.latitude, position.coords.longitude));
      setLocationCapturedAt(new Date(position.timestamp).toISOString());
      if (!location.trim()) setLocation('GPS pin');
      setLocationStatus('Current field position saved to this task.');
    } catch {
      setLocationStatus('Could not get a field position. Check your device location service and try again.');
    } finally {
      setCapturingLocation(false);
    }
  };

  const submit = () => {
    if (!task.trim()) return;
    const coordinates = parseCoordinatePair(coordinateText);
    if (!coordinates) {
      setLocationStatus('Enter coordinates like 41°12\'59.40"S 172°54\'26.16"E.');
      return;
    }
    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(calendarStart);
    const scheduledAt = isDateOnly ? calendarStart : calendarStart ? parseAucklandDateTimeInput(calendarStart) : '';
    if (calendarStart && !scheduledAt) {
      setLocationStatus('Enter a valid Pacific/Auckland date and time (YYYY-MM-DDTHH:mm).');
      return;
    }
    if (recurrence !== 'none' && !scheduledAt) {
      setLocationStatus(recurrence === 'weekly'
        ? 'Weekly tasks require a scheduled date and time.'
        : 'Recurring tasks require a scheduled date and time.');
      return;
    }
    const nextTask = withTeamAssignment<TaskInput>({
      task: task.trim(),
      group,
      urgency,
      month: month.trim(),
      location: location.trim(),
      ...coordinates,
      locationCapturedAt,
      atlasLink: atlasLink.trim(),
      notes: notes.trim(),
      link: link.trim(),
      subtasks: subtasksText.split('\n').map((title, index) => title.trim()).filter(Boolean).map((title, index) => ({ id: `step-${index}`, title, done: false })),
      calendarStart: scheduledAt ?? '',
      recurrence,
      repeatWeekly: recurrence === 'weekly',
    }, assigneeIds, assigneeNames);
    if (editingTask) {
      onUpdate?.(editingTask.id, nextTask);
    } else {
      onCreate?.(nextTask, attachments);
    }
    setTask('');
     setGroup(defaultGroup);
     setUrgency(defaultUrgency);
    setMonth('');
     setLocation(defaultLocation);
    setLatitude(null);
    setLongitude(null);
    setCoordinateText('');
    setLocationCapturedAt(null);
    setAtlasLink('');
    setLocationStatus('');
    setNotes('');
    setSubtasksText('');
    setLink('');
    setCalendarStart('');
    setRecurrence('none');
    setAssigneeIds([]);
    setAssigneeNames([]);
    setAttachments([]);
  };

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.scrim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
         <View style={[styles.sheet, { backgroundColor: colors.card }]}>
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />
          <View style={styles.heading}>
            <View>
              <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>INBOX</Text>
              <Text style={[styles.title, { color: colors.foreground }]}>{isEditing ? 'Edit task' : 'Add a task'}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10}>
              <Feather name="x" size={22} color={colors.mutedForeground} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.formScroll} contentContainerStyle={styles.form}>
          <TextInput
            testID="quick-task-input"
            autoFocus
            value={task}
            onChangeText={setTask}
            onSubmitEditing={submit}
            returnKeyType="done"
            placeholder="What needs doing?"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { backgroundColor: colors.muted, color: colors.foreground }]}
          />
           <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Category</Text>
            <View style={styles.choiceRow}>
              {groups.map((value) => <Pressable key={value} onPress={() => setGroup(value)} style={[styles.choice, { borderColor: colors.border }, group === value && { backgroundColor: colors.secondary, borderColor: colors.primary }]}><Text style={{ color: group === value ? colors.primary : colors.mutedForeground, fontSize: 12, fontWeight: '700' }}>{value}</Text></Pressable>)}
            </View>
           <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Month</Text>
           <View style={styles.choiceRow}>
             <Pressable onPress={() => setMonth('')} style={[styles.choice, { borderColor: colors.border }, !month && { backgroundColor: colors.secondary, borderColor: colors.primary }]}><Text style={{ color: !month ? colors.primary : colors.mutedForeground, fontSize: 12, fontWeight: '700' }}>No month</Text></Pressable>
             {selectableMonths.map((value) => <Pressable key={value} onPress={() => setMonth(value)} style={[styles.choice, { borderColor: colors.border }, month === value && { backgroundColor: colors.secondary, borderColor: colors.primary }]}><Text style={{ color: month === value ? colors.primary : colors.mutedForeground, fontSize: 12, fontWeight: '700' }}>{monthLabel(value)}</Text></Pressable>)}
           </View>
          <View style={styles.priorityRow}>
            {(['Urgent', 'High', 'Medium', 'Low'] as const).map((value) => <Pressable key={value} onPress={() => setUrgency(value)} style={[styles.priority, { borderColor: colors.border }, urgency === value && { backgroundColor: colors.secondary, borderColor: colors.primary }]}><Text style={{ color: urgency === value ? colors.primary : colors.mutedForeground, fontSize: 12, fontWeight: '700' }}>{value}</Text></Pressable>)}
          </View>
           <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Scheduled date & time (Pacific/Auckland)</Text>
            <MobileScheduledDatePicker value={calendarStart} onChange={setCalendarStart} colors={colors} />
            {canAssign ? (
              <>
                <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Assigned team</Text>
                <View style={styles.choiceRow}>
                  <Pressable testID="mobile-select-task-assignee-unassigned" accessibilityRole="button" accessibilityLabel="Clear all task assignees" accessibilityState={{ selected: !assigneeIds.length }} onPress={() => { setAssigneeIds([]); setAssigneeNames([]); }} style={[styles.choice, { borderColor: colors.border }, !assigneeIds.length && { backgroundColor: colors.secondary, borderColor: colors.primary }]}>
                    <Text style={{ color: !assigneeIds.length ? colors.primary : colors.mutedForeground, fontSize: 12, fontWeight: '700' }}>Unassigned</Text>
                  </Pressable>
                  {workers.filter((worker) => worker.status === 'active' || worker.status === 'invited').map((worker) => (
                    <Pressable key={worker.clerkId} testID={`mobile-select-task-assignee-${worker.clerkId}`} accessibilityRole="checkbox" accessibilityLabel={`Assign ${worker.displayName}`} accessibilityState={{ checked: assigneeIds.includes(worker.clerkId) }} onPress={() => {
                      const selected = assigneeIds.includes(worker.clerkId);
                      setAssigneeIds((current) => selected ? current.filter((id) => id !== worker.clerkId) : [...current, worker.clerkId]);
                      setAssigneeNames((current) => selected ? current.filter((_, index) => assigneeIds[index] !== worker.clerkId) : [...current, worker.displayName]);
                    }} style={[styles.choice, { borderColor: colors.border }, assigneeIds.includes(worker.clerkId) && { backgroundColor: colors.secondary, borderColor: colors.primary }]}>
                      <Text style={{ color: assigneeIds.includes(worker.clerkId) ? colors.primary : colors.mutedForeground, fontSize: 12, fontWeight: '700' }}>{worker.displayName}{worker.status === 'invited' ? ' (Invited)' : ''}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : editingTask ? (
              <>
                <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Assigned team</Text>
                <Text testID="mobile-task-assignees-readonly" style={[styles.readonlyAssignment, { color: colors.foreground, backgroundColor: colors.muted }]}>
                  {assigneeNames.length ? assigneeNames.join(', ') : 'Unassigned'}
                </Text>
              </>
            ) : null}
          <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Repeat</Text>
          <View style={styles.choiceRow}>
            {([
              ['none', 'Does not repeat'],
              ['weekly', 'Every week'],
              ['biweekly', 'Every 2 weeks'],
              ['every4weeks', 'Every 4 weeks'],
              ['monthly', 'Every month'],
              ['quarterly', 'Every 3 months'],
              ['yearly', 'Every year'],
            ] as const).map(([value, label]) => (
              <Pressable
                key={value}
                disabled={editingTask?.source === 'Google Calendar'}
                onPress={() => setRecurrence(value)}
                style={[styles.choice, { borderColor: colors.border }, recurrence === value && { backgroundColor: colors.secondary, borderColor: colors.primary }, editingTask?.source === 'Google Calendar' && { opacity: 0.5 }]}
              >
                <Text style={{ color: recurrence === value ? colors.primary : colors.mutedForeground, fontSize: 12, fontWeight: '700' }}>{label}</Text>
              </Pressable>
            ))}
          </View>
          {editingTask?.source === 'Google Calendar' ? <Text style={[styles.calendarHint, { color: colors.mutedForeground }]}>Imported calendar tasks cannot become manual recurring routines.</Text> : null}
            <TextInput value={location} onChangeText={setLocation} placeholder="Location or block" placeholderTextColor={colors.mutedForeground} style={[styles.input, { backgroundColor: colors.muted, color: colors.foreground }]} />
            {locations.length ? <View style={styles.choiceRow}>{locations.map((value) => <Pressable key={value} onPress={() => setLocation(value)} style={[styles.choice, { borderColor: colors.border }, location === value && { backgroundColor: colors.secondary, borderColor: colors.primary }]}><Text style={{ color: location === value ? colors.primary : colors.mutedForeground, fontSize: 12, fontWeight: '700' }}>{value}</Text></Pressable>)}</View> : null}
           <Pressable testID="capture-task-location" disabled={capturingLocation || saving} onPress={() => void captureCurrentLocation()} style={[styles.captureLocation, { backgroundColor: colors.secondary, borderColor: colors.border }, (capturingLocation || saving) && { opacity: 0.55 }]}>
             <Feather name={capturingLocation ? 'loader' : 'crosshair'} size={16} color={colors.primary} />
             <Text style={[styles.captureText, { color: colors.primary }]}>{capturingLocation ? 'Finding your position…' : latitude !== null && longitude !== null ? 'Update current GPS pin' : 'Use current location'}</Text>
           </Pressable>
            <TextInput value={coordinateText} onChangeText={setCoordinateText} placeholder={'41°12\'59.40"S 172°54\'26.16"E'} placeholderTextColor={colors.mutedForeground} style={[styles.input, { backgroundColor: colors.muted, color: colors.foreground }]} />
            {coordinateText ? <Text style={[styles.coordinateText, { color: colors.mutedForeground }]}>{locationCapturedAt ? 'GPS position saved to this task.' : 'Coordinates are saved as a GPS pin.'}</Text> : null}
           {locationStatus ? <Text style={[styles.locationStatus, { color: locationStatus.startsWith('Could') || locationStatus.startsWith('Location permission') ? colors.destructive : colors.primary }]}>{locationStatus}</Text> : null}
           <TextInput value={atlasLink} onChangeText={setAtlasLink} placeholder="Atlas shared map link (optional)" placeholderTextColor={colors.mutedForeground} autoCapitalize="none" keyboardType="url" style={[styles.input, { backgroundColor: colors.muted, color: colors.foreground }]} />
          <TextInput value={notes} onChangeText={setNotes} placeholder="Notes" placeholderTextColor={colors.mutedForeground} multiline style={[styles.input, styles.multiline, { backgroundColor: colors.muted, color: colors.foreground }]} />
          <TextInput value={subtasksText} onChangeText={setSubtasksText} placeholder="Steps, one per line" placeholderTextColor={colors.mutedForeground} multiline style={[styles.input, styles.multiline, { backgroundColor: colors.muted, color: colors.foreground }]} />
          <TextInput value={link} onChangeText={setLink} placeholder="Reference link" placeholderTextColor={colors.mutedForeground} autoCapitalize="none" keyboardType="url" style={[styles.input, { backgroundColor: colors.muted, color: colors.foreground }]} />
            {!isEditing ? (
              <View style={styles.attachmentSection}>
             <View style={styles.attachmentHeading}>
               <View>
                 <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Photos & files</Text>
                 <Text style={[styles.attachmentHint, { color: colors.mutedForeground }]}>Add now; uploads start after the task is saved.</Text>
                </View>
               {attachments.length ? <Text style={[styles.attachmentCount, { color: colors.primary }]}>{attachments.length} ready</Text> : null}
             </View>
             {attachments.length ? <View style={styles.attachmentList}>{attachments.map((file, index) => <View key={`${file.name}-${index}`} style={[styles.attachmentItem, { backgroundColor: colors.muted, borderColor: colors.border }]}><Feather name={file.contentType.startsWith('image/') ? 'image' : 'paperclip'} size={15} color={colors.mutedForeground} /><Text numberOfLines={1} style={[styles.attachmentName, { color: colors.foreground }]}>{file.name}</Text><Pressable testID={`remove-staged-attachment-${index}`} onPress={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))} hitSlop={8}><Feather name="x" size={16} color={colors.mutedForeground} /></Pressable></View>)}</View> : null}
             <AttachmentPicker disabled={saving} onPicked={(files) => setAttachments((current) => [...current, ...files])} />
              </View>
            ) : null}
          <Pressable
            testID="quick-task-save"
            disabled={!task.trim() || saving}
            onPress={submit}
            style={[
              styles.save,
              { backgroundColor: colors.primary },
              (!task.trim() || saving) && { opacity: 0.45 },
            ]}
          >
            <Feather name="plus" size={19} color={colors.primaryForeground} />
            <Text style={[styles.saveText, { color: colors.primaryForeground }]}>{saving ? 'Saving…' : isEditing ? 'Save changes' : 'Add task'}</Text>
          </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

type MobileScheduledDatePickerProps = {
  value: string;
  onChange: (value: string) => void;
  colors: ReturnType<typeof useColors>;
};

function getLocalTime(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const writtenTime = value.match(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):([0-5]\d)/);
  if (writtenTime && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return `${writtenTime[1]}:${writtenTime[2]}`;
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}

function MobileScheduledDatePicker({ value, onChange, colors }: MobileScheduledDatePickerProps) {
  const initialDate = calendarDateKey(value) ?? calendarDateKey(new Date().toISOString()) ?? '';
  const [selectedDate, setSelectedDate] = useState(calendarDateKey(value) ?? '');
  const [time, setTime] = useState(getLocalTime(value));
  const [displayMonth, setDisplayMonth] = useState(initialDate.slice(0, 7));
  const days = useMemo(() => calendarMonthDays(displayMonth), [displayMonth]);

  useEffect(() => {
    const nextDate = calendarDateKey(value) ?? '';
    setSelectedDate(nextDate);
    setTime(getLocalTime(value));
    if (nextDate) setDisplayMonth(nextDate.slice(0, 7));
  }, [value]);

  const chooseDate = (dateKey: string) => {
    setSelectedDate(dateKey);
    const next = time ? `${dateKey}T${time}` : dateKey;
    onChange(time ? (parseAucklandDateTimeInput(next) ?? next) : next);
  };
  const changeTime = (nextTime: string) => {
    setTime(nextTime);
    if (!selectedDate) return;
    const next = nextTime ? `${selectedDate}T${nextTime}` : selectedDate;
    onChange(nextTime ? (parseAucklandDateTimeInput(next) ?? next) : next);
  };
  const clear = () => {
    setSelectedDate('');
    setTime('');
    setDisplayMonth((calendarDateKey(new Date().toISOString()) ?? '').slice(0, 7));
    onChange('');
  };

  return (
    <View testID="mobile-task-schedule-picker" style={[styles.calendarPanel, { backgroundColor: colors.muted, borderColor: colors.border }]}>
      <View style={styles.calendarHeader}>
        <Pressable testID="mobile-calendar-previous-month" accessibilityRole="button" accessibilityLabel="Previous calendar month" onPress={() => setDisplayMonth((month) => shiftCalendarMonth(month, -1))} style={styles.iconButton}>
          <Feather name="chevron-left" size={19} color={colors.mutedForeground} />
        </Pressable>
        <Text testID="mobile-calendar-month" style={[styles.calendarTitle, { color: colors.foreground }]}>{calendarMonthLabel(displayMonth)}</Text>
        <Pressable testID="mobile-calendar-next-month" accessibilityRole="button" accessibilityLabel="Next calendar month" onPress={() => setDisplayMonth((month) => shiftCalendarMonth(month, 1))} style={styles.iconButton}>
          <Feather name="chevron-right" size={19} color={colors.mutedForeground} />
        </Pressable>
      </View>
      <View style={styles.weekdayRow}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => <Text key={`${day}-${index}`} style={[styles.weekday, { color: colors.mutedForeground }]}>{day}</Text>)}
      </View>
      <View style={styles.dayGrid}>
        {days.map((dateKey) => {
          const isCurrentMonth = dateKey.slice(0, 7) === displayMonth;
          const isSelected = dateKey === selectedDate;
          return (
            <Pressable key={dateKey} testID={`mobile-calendar-date-${dateKey}`} accessibilityRole="button" accessibilityLabel={`Choose ${dateKey}`} accessibilityState={{ selected: isSelected }} onPress={() => chooseDate(dateKey)} style={[styles.dayButton, isSelected && { backgroundColor: colors.primary }]}>
              <Text style={[styles.dayText, { color: isSelected ? colors.primaryForeground : isCurrentMonth ? colors.foreground : colors.mutedForeground }, !isCurrentMonth && { opacity: 0.4 }]}>{Number(dateKey.slice(8, 10))}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={[styles.timeRow, { borderTopColor: colors.border }]}>
        <View style={styles.timeInputWrap}>
          <Text style={[styles.timeLabel, { color: colors.mutedForeground }]}>Time in Auckland</Text>
          <TextInput testID="mobile-input-task-calendar-time" value={time} onChangeText={changeTime} placeholder="Optional" placeholderTextColor={colors.mutedForeground} keyboardType="numbers-and-punctuation" style={[styles.smallInput, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]} />
        </View>
        {(selectedDate || time) ? (
          <Pressable testID="mobile-clear-task-calendar" accessibilityRole="button" accessibilityLabel="Clear scheduled date and time" onPress={clear} style={[styles.clearButton, { borderColor: colors.border }]}>
            <Feather name="x" size={15} color={colors.mutedForeground} /><Text style={[styles.clearText, { color: colors.mutedForeground }]}>Clear</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={[styles.calendarHint, { color: colors.mutedForeground }]}>Choose a date and optional time, or clear it for unscheduled work.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20, 28, 24, 0.38)' },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, paddingBottom: 34, gap: 18 },
  grabber: { width: 42, height: 5, borderRadius: 999, alignSelf: 'center' },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { fontSize: 11, letterSpacing: 1.4, fontWeight: '800' },
  title: { fontSize: 25, fontWeight: '800', marginTop: 3 },
  input: { borderRadius: 14, paddingHorizontal: 15, paddingVertical: 15, fontSize: 16 },
  captureLocation: { minHeight: 44, borderWidth: 1, borderRadius: 13, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  captureText: { fontSize: 13, fontWeight: '800' },
  coordinateText: { marginTop: -5, fontSize: 11, fontWeight: '600' },
  locationStatus: { marginTop: -5, fontSize: 12, lineHeight: 17 },
  formScroll: { maxHeight: 440 },
  form: { gap: 12 },
  row: { flexDirection: 'row', gap: 10 },
  smallInput: { flex: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 13, fontSize: 14 },
  fieldLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  choice: { borderWidth: 1, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 8 },
  readonlyAssignment: { borderRadius: 14, paddingHorizontal: 15, paddingVertical: 13, fontSize: 14, fontWeight: '700' },
  cancelGroup: { padding: 12, justifyContent: 'center' },
  priorityRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  priority: { borderWidth: 1, borderRadius: 99, paddingHorizontal: 11, paddingVertical: 8 },
  repeatChoice: { minHeight: 44, borderWidth: 1, borderRadius: 13, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 8 },
  calendarPanel: { borderWidth: 1, borderRadius: 15, padding: 10, gap: 8 },
  calendarHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  calendarTitle: { fontSize: 15, fontWeight: '800' },
  iconButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  weekdayRow: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', fontSize: 10, fontWeight: '800' },
  dayGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayButton: { width: '14.2857%', minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  dayText: { fontSize: 12, fontWeight: '700' },
  timeRow: { borderTopWidth: 1, paddingTop: 9, flexDirection: 'row', alignItems: 'flex-end', gap: 9 },
  timeInputWrap: { flex: 1 },
  timeLabel: { fontSize: 11, fontWeight: '800', marginBottom: 4 },
  clearButton: { minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 5 },
  clearText: { fontSize: 12, fontWeight: '800' },
  calendarHint: { fontSize: 11, lineHeight: 16 },
  multiline: { minHeight: 68, textAlignVertical: 'top' },
  save: { height: 52, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  saveText: { fontSize: 16, fontWeight: '800' },
  attachmentSection: { gap: 10 },
  attachmentHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  attachmentHint: { fontSize: 12, lineHeight: 17, marginTop: 3 },
  attachmentCount: { fontSize: 12, fontWeight: '800' },
  attachmentList: { gap: 7 },
  attachmentItem: { minHeight: 40, borderWidth: 1, borderRadius: 11, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  attachmentName: { flex: 1, fontSize: 12, fontWeight: '600' },
});