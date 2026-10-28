import { Feather } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  customFetch,
  getGetFarmSettingsQueryKey,
  getGetDailyPlanSettingsQueryKey,
  getListFarmTasksQueryKey,
  useGetFarmSettings,
  useListFarmTasks,
  useUpdateFarmSettings,
  useGetDailyPlanSettings,
  useUpdateDailyPlanSettings,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useAccountIdentity } from '@/hooks/useAccountIdentity';
import { resolveDefaultLocation } from '@/lib/farm-settings-options';

type Member = { clerkId: string; role: string; isHarnold?: boolean };

export default function SettingsScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const activeIdentity = useAccountIdentity();
  const memberQuery = useQuery({
    queryKey: ['/api/me', activeIdentity],
    queryFn: () => customFetch<Member>('/api/me'),
    enabled: Boolean(activeIdentity),
  });
  const verifiedMember = memberQuery.data?.clerkId === activeIdentity ? memberQuery.data : null;
  const accountScope = verifiedMember?.clerkId ?? null;
  const isOwner = verifiedMember?.role === 'master';
  const isHarnold = verifiedMember?.isHarnold === true;
  const dailySettings = useGetDailyPlanSettings({
    query: {
      queryKey: [...getGetDailyPlanSettingsQueryKey(), accountScope],
      enabled: Boolean(accountScope) && isOwner,
    },
  });
  const updateDailySettings = useUpdateDailyPlanSettings({
    mutation: { onSuccess: () => void dailySettings.refetch() },
  });
  const farmSettings = useGetFarmSettings({
    query: { queryKey: ['/api/farm-settings', accountScope], enabled: Boolean(accountScope) },
  });
  const taskSource = useListFarmTasks({ includeDone: true }, {
    query: {
      queryKey: [...getListFarmTasksQueryKey({ includeDone: true }), accountScope],
      enabled: Boolean(accountScope),
      staleTime: 30_000,
    },
  });
  const sheetUrl = taskSource.data?.sourceUrl?.startsWith('https://') ? taskSource.data.sourceUrl : '';
  const [groups, setGroups] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [newGroup, setNewGroup] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [defaultGroup, setDefaultGroup] = useState('');
  const [defaultUrgency, setDefaultUrgency] = useState<'Urgent' | 'High' | 'Medium' | 'Low'>('Medium');
  const [defaultLocation, setDefaultLocation] = useState('');
  const [settingsMessage, setSettingsMessage] = useState('');
  useEffect(() => {
    if (!farmSettings.data) return;
    setGroups(farmSettings.data.groups);
    setLocations(farmSettings.data.locations);
    setDefaultGroup(farmSettings.data.groups.includes(farmSettings.data.defaultGroup) ? farmSettings.data.defaultGroup : farmSettings.data.groups[0] ?? '');
    setDefaultUrgency(farmSettings.data.defaultUrgency);
    setDefaultLocation(farmSettings.data.locations.includes(farmSettings.data.defaultLocation) ? farmSettings.data.defaultLocation : farmSettings.data.locations[0] ?? '');
  }, [farmSettings.data]);
  const updateFarmSettings = useUpdateFarmSettings({
    mutation: {
      onSuccess: (settings) => {
        setGroups(settings.groups);
        setLocations(settings.locations);
        setDefaultGroup(settings.defaultGroup);
        setDefaultUrgency(settings.defaultUrgency);
        setDefaultLocation(settings.defaultLocation);
        queryClient.setQueryData(['/api/farm-settings', accountScope], settings);
        queryClient.setQueryData(getGetFarmSettingsQueryKey(), settings);
        setSettingsMessage('Shared task options saved.');
      },
      onError: (error) => {
        const detail = (error as { data?: { error?: unknown } } | null)?.data?.error;
        setSettingsMessage(typeof detail === 'string' ? detail : 'Could not save shared task options.');
      },
    },
  });
  const saveFarmSettings = () => {
    const nextGroups = Array.from(new Set(groups.map((item) => item.trim()).filter(Boolean)));
    const nextLocations = Array.from(new Set(locations.map((item) => item.trim()).filter(Boolean)));
    if (!nextGroups.length) return setSettingsMessage('Keep at least one work group.');
    const nextDefaultGroup = nextGroups.includes(defaultGroup.trim()) ? defaultGroup.trim() : nextGroups[0]!;
    const nextDefaultLocation = resolveDefaultLocation(nextLocations, defaultLocation);
    setGroups(nextGroups);
    setLocations(nextLocations);
    setDefaultGroup(nextDefaultGroup);
    setDefaultLocation(nextDefaultLocation);
    updateFarmSettings.mutate({ data: { groups: nextGroups, locations: nextLocations, defaultGroup: nextDefaultGroup, defaultUrgency, defaultLocation: nextDefaultLocation } });
  };
  const addGroup = () => {
    const value = newGroup.trim();
    if (!value) return setSettingsMessage('Enter a group name before adding it.');
    if (groups.some((group) => group.toLocaleLowerCase() === value.toLocaleLowerCase())) return setSettingsMessage('That work group is already listed.');
    setGroups((current) => [...current, value]);
    if (!defaultGroup) setDefaultGroup(value);
    setNewGroup('');
    setSettingsMessage('');
  };
  const addLocation = () => {
    const value = newLocation.trim();
    if (!value) return setSettingsMessage('Enter a location name before adding it.');
    if (locations.some((location) => location.toLocaleLowerCase() === value.toLocaleLowerCase())) return setSettingsMessage('That location is already listed.');
    setLocations((current) => [...current, value]);
    if (!defaultLocation) setDefaultLocation(value);
    setNewLocation('');
    setSettingsMessage('');
  };
  const removeGroup = (index: number) => {
    if (groups.length === 1) return setSettingsMessage('Keep at least one work group.');
    const next = groups.filter((_, itemIndex) => itemIndex !== index);
    setGroups(next);
    setDefaultGroup((current) => next.includes(current) ? current : next[0] ?? '');
    setSettingsMessage('');
  };
  const removeLocation = (index: number) => {
    const next = locations.filter((_, itemIndex) => itemIndex !== index);
    setLocations(next);
    setDefaultLocation((current) => next.includes(current) ? current : next[0] ?? '');
    setSettingsMessage('');
  };
  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.background }]} contentContainerStyle={styles.content}>
      <Text style={[styles.title, { color: colors.foreground }]}>Planner</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>A single task list for orchard and pasture work.</Text>
      {isOwner && dailySettings.data ? (
        <View testID="daily-plan-settings" style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.icon, { backgroundColor: colors.secondary }]}>
            <Feather name="sunrise" size={22} color={colors.primary} />
          </View>
          <View style={styles.copy}>
            <View style={styles.settingHeading}>
              <View style={styles.copy}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>Automatic daily brief</Text>
                <Text style={[styles.cardText, { color: colors.mutedForeground }]}>
                  Runs at {dailySettings.data.runAtLocal} · up to {dailySettings.data.maxTasks} tasks
                </Text>
              </View>
              <Pressable
                testID="toggle-daily-plan"
                accessibilityRole="switch"
                accessibilityState={{ checked: dailySettings.data.enabled }}
                disabled={updateDailySettings.isPending}
                onPress={() => updateDailySettings.mutate({ data: { enabled: !dailySettings.data.enabled } })}
                style={[styles.switch, { backgroundColor: dailySettings.data.enabled ? colors.primary : colors.muted }]}
              >
                <View style={[styles.switchThumb, { backgroundColor: colors.primaryForeground }, dailySettings.data.enabled && styles.switchThumbOn]} />
              </Pressable>
            </View>
            <Text style={[styles.cardText, { color: colors.mutedForeground }]}>
              {dailySettings.data.enabled ? `Next briefs use ${dailySettings.data.timezone}.` : 'Automatic generation is paused. Owners can still refresh Today manually.'}
            </Text>
          </View>
        </View>
      ) : null}
      {isHarnold ? (
        <View testID="farm-settings" style={[styles.card, styles.settingsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.icon, { backgroundColor: colors.secondary }]}><Feather name="sliders" size={22} color={colors.primary} /></View>
          <View style={styles.copy}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Shared task options</Text>
            <Text style={[styles.cardText, { color: colors.mutedForeground }]}>Used by every planner and phone.</Text>
            <Text style={[styles.sectionLabel, { color: colors.foreground }]}>Work groups</Text>
            {groups.map((value, index) => <View key={`group-${index}`} style={styles.optionRow}><TextInput value={value} onChangeText={(nextValue) => { setGroups((current) => current.map((item, itemIndex) => itemIndex === index ? nextValue : item)); if (defaultGroup === value) setDefaultGroup(nextValue); }} accessibilityLabel={`Work group ${index + 1}`} style={[styles.optionInput, { backgroundColor: colors.muted, color: colors.foreground, borderColor: colors.border }]} /><Pressable accessibilityLabel={`Remove ${value || 'group'}`} disabled={groups.length === 1} onPress={() => removeGroup(index)} style={[styles.removeButton, { borderColor: colors.border, opacity: groups.length === 1 ? 0.35 : 1 }]}><Feather name="trash-2" size={16} color={colors.mutedForeground} /></Pressable></View>)}
            <View style={styles.optionRow}><TextInput value={newGroup} onChangeText={setNewGroup} onSubmitEditing={addGroup} placeholder="Add group" placeholderTextColor={colors.mutedForeground} style={[styles.optionInput, { backgroundColor: colors.muted, color: colors.foreground, borderColor: colors.border }]} /><Pressable accessibilityLabel="Add work group" onPress={addGroup} style={[styles.addButton, { backgroundColor: colors.secondary }]}><Feather name="plus" size={16} color={colors.primary} /><Text style={{ color: colors.primary, fontWeight: '800', fontSize: 12 }}>Add</Text></Pressable></View>
            <Text style={[styles.sectionLabel, { color: colors.foreground }]}>Default group</Text>
            <View style={styles.choiceRow}>{groups.map((value) => value.trim()).filter(Boolean).map((value) => <Pressable key={value} onPress={() => setDefaultGroup(value)} style={[styles.choice, { borderColor: colors.border }, defaultGroup === value && { backgroundColor: colors.secondary, borderColor: colors.primary }]}><Text style={{ color: defaultGroup === value ? colors.primary : colors.mutedForeground, fontSize: 12, fontWeight: '700' }}>{value}</Text></Pressable>)}</View>
            <Text style={[styles.sectionLabel, { color: colors.foreground }]}>Locations</Text>
            {locations.length ? locations.map((value, index) => <View key={`location-${index}`} style={styles.optionRow}><TextInput value={value} onChangeText={(nextValue) => { setLocations((current) => current.map((item, itemIndex) => itemIndex === index ? nextValue : item)); if (defaultLocation === value) setDefaultLocation(nextValue); }} accessibilityLabel={`Location ${index + 1}`} style={[styles.optionInput, { backgroundColor: colors.muted, color: colors.foreground, borderColor: colors.border }]} /><Pressable accessibilityLabel={`Remove ${value || 'location'}`} onPress={() => removeLocation(index)} style={[styles.removeButton, { borderColor: colors.border }]}><Feather name="trash-2" size={16} color={colors.mutedForeground} /></Pressable></View>) : <Text style={[styles.cardText, { color: colors.mutedForeground }]}>No locations saved.</Text>}
            <View style={styles.optionRow}><TextInput value={newLocation} onChangeText={setNewLocation} onSubmitEditing={addLocation} placeholder="Add location" placeholderTextColor={colors.mutedForeground} style={[styles.optionInput, { backgroundColor: colors.muted, color: colors.foreground, borderColor: colors.border }]} /><Pressable accessibilityLabel="Add location" onPress={addLocation} style={[styles.addButton, { backgroundColor: colors.secondary }]}><Feather name="plus" size={16} color={colors.primary} /><Text style={{ color: colors.primary, fontWeight: '800', fontSize: 12 }}>Add</Text></Pressable></View>
            <Text style={[styles.sectionLabel, { color: colors.foreground }]}>Default location</Text>
            <View style={styles.choiceRow}><Pressable onPress={() => setDefaultLocation('')} style={[styles.choice, { borderColor: colors.border }, !defaultLocation && { backgroundColor: colors.secondary, borderColor: colors.primary }]}><Text style={{ color: !defaultLocation ? colors.primary : colors.mutedForeground, fontSize: 12, fontWeight: '700' }}>None</Text></Pressable>{locations.map((value) => value.trim()).filter(Boolean).map((value) => <Pressable key={value} onPress={() => setDefaultLocation(value)} style={[styles.choice, { borderColor: colors.border }, defaultLocation === value && { backgroundColor: colors.secondary, borderColor: colors.primary }]}><Text style={{ color: defaultLocation === value ? colors.primary : colors.mutedForeground, fontSize: 12, fontWeight: '700' }}>{value}</Text></Pressable>)}</View>
            <Text style={[styles.sectionLabel, { color: colors.foreground }]}>Default priority</Text>
            <View style={styles.choiceRow}>{(['Urgent', 'High', 'Medium', 'Low'] as const).map((value) => <Pressable key={value} onPress={() => setDefaultUrgency(value)} style={[styles.choice, { borderColor: colors.border }, defaultUrgency === value && { backgroundColor: colors.secondary, borderColor: colors.primary }]}><Text style={{ color: defaultUrgency === value ? colors.primary : colors.mutedForeground, fontSize: 12, fontWeight: '700' }}>{value}</Text></Pressable>)}</View>
            {settingsMessage ? <Text style={[styles.cardText, { color: colors.primary }]}>{settingsMessage}</Text> : null}
            <Pressable onPress={saveFarmSettings} disabled={updateFarmSettings.isPending || farmSettings.isLoading} style={[styles.saveButton, { backgroundColor: colors.primary, opacity: updateFarmSettings.isPending ? 0.6 : 1 }]}>{updateFarmSettings.isPending ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={{ color: colors.primaryForeground, fontWeight: '800' }}>Save shared options</Text>}</Pressable>
          </View>
        </View>
      ) : (
        <View style={[styles.note, { backgroundColor: colors.secondary, borderRadius: 12, padding: 12 }]}><Feather name="lock" size={16} color={colors.mutedForeground} /><Text style={[styles.noteText, { color: colors.mutedForeground }]}>Shared task options are managed by Harnold.</Text></View>
      )}
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.icon, { backgroundColor: colors.secondary }]}>
          <Feather name="grid" size={22} color={colors.primary} />
        </View>
        <View style={styles.copy}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Google Sheets is the source of truth</Text>
          <Text style={[styles.cardText, { color: colors.mutedForeground }]}>Edits made here appear in the connected sheet, and sheet edits show up after refresh.</Text>
        </View>
      </View>
       {sheetUrl ? <Pressable testID="open-google-sheet" accessibilityRole="link" accessibilityLabel="Open the task sheet in Google Sheets" onPress={() => Linking.openURL(sheetUrl)} style={({ pressed }) => [styles.linkCard, { borderColor: colors.border, opacity: pressed ? 0.78 : 1 }]}>
        <View style={styles.linkCopy}><Text style={[styles.linkTitle, { color: colors.foreground }]}>Open the task sheet</Text><Text style={[styles.linkText, { color: colors.mutedForeground }]}>Use the full spreadsheet when you need a wide view.</Text></View>
        <Feather name="external-link" size={20} color={colors.primary} />
       </Pressable> : <View testID="google-sheet-unavailable" style={[styles.linkCard, { borderColor: colors.border }]}><View style={styles.linkCopy}><Text style={[styles.linkTitle, { color: colors.foreground }]}>Task sheet unavailable</Text><Text style={[styles.linkText, { color: colors.mutedForeground }]}>{taskSource.isLoading ? 'Reading the connected source…' : 'Refresh the planner connection before opening the spreadsheet.'}</Text></View><Feather name="alert-circle" size={20} color={colors.mutedForeground} /></View>}
      <View style={styles.note}>
        <Feather name="refresh-cw" size={16} color={colors.mutedForeground} />
        <Text style={[styles.noteText, { color: colors.mutedForeground }]}>The app refreshes when opened and checks for shared changes regularly.</Text>
      </View>
      <View style={[styles.note, { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 14 }]}>
        <Feather name="message-circle" size={16} color={colors.mutedForeground} />
        <Text style={[styles.noteText, { color: colors.mutedForeground }]}>Claude task drafting is available in the web assistant. Owners can review and approve prepared suggestions from Today on mobile.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 20, gap: 14, paddingBottom: 118 },
  title: { fontSize: 28, fontWeight: '800', marginTop: 2 },
  subtitle: { fontSize: 14, lineHeight: 20, marginBottom: 9 },
  card: { borderWidth: 1, borderRadius: 18, padding: 16, flexDirection: 'row', gap: 13 },
  icon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, gap: 4 },
  settingHeading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardTitle: { fontSize: 16, fontWeight: '800', lineHeight: 22 },
  cardText: { fontSize: 13, lineHeight: 19 },
  linkCard: { borderWidth: 1, borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  linkCopy: { flex: 1, gap: 3 },
  linkTitle: { fontSize: 15, fontWeight: '800' },
  linkText: { fontSize: 13, lineHeight: 18 },
  note: { flexDirection: 'row', gap: 8, padding: 5, marginTop: 4 },
  noteText: { flex: 1, fontSize: 12, lineHeight: 18 },
  switch: { width: 46, height: 26, borderRadius: 13, padding: 3, justifyContent: 'center' },
  switchThumb: { width: 20, height: 20, borderRadius: 10 },
  switchThumbOn: { alignSelf: 'flex-end' },
  settingsCard: { alignItems: 'flex-start' },
  settingsInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9, marginTop: 10, minHeight: 42, textAlignVertical: 'top' },
  sectionLabel: { fontSize: 12, fontWeight: '800', marginTop: 12 },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  optionInput: { flex: 1, minWidth: 0, borderWidth: 1, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9, minHeight: 42 },
  removeButton: { width: 42, height: 42, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  addButton: { minHeight: 42, borderRadius: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  choice: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  saveButton: { marginTop: 12, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, alignItems: 'center' },
});