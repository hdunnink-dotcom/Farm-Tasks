import { Feather } from '@expo/vector-icons';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { FarmTask } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { googleMapsRouteUrl, hasCoordinates, type LocatedFarmTask } from '@/lib/task-location';

type Props = {
  visible: boolean;
  tasks: FarmTask[];
  monthLabel: string;
  onClose: () => void;
  onOpenTask: (task: FarmTask) => void;
};

export function TaskMapSheet({ visible, tasks, monthLabel, onClose, onOpenTask }: Props) {
  const colors = useColors();
  const located = tasks.filter((task): task is LocatedFarmTask => hasCoordinates(task));
  const routeUrl = googleMapsRouteUrl(located);
  const latitudes = located.map((task) => task.latitude);
  const longitudes = located.map((task) => task.longitude);
  const minLatitude = located.length ? Math.min(...latitudes) : 0;
  const maxLatitude = located.length ? Math.max(...latitudes) : 1;
  const minLongitude = located.length ? Math.min(...longitudes) : 0;
  const maxLongitude = located.length ? Math.max(...longitudes) : 1;
  const latRange = Math.max(maxLatitude - minLatitude, 0.0001);
  const longRange = Math.max(maxLongitude - minLongitude, 0.0001);

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.scrim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: colors.card }]}>
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />
          <View style={styles.heading}>
            <View>
              <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>FIELD ROUTE · {monthLabel.toUpperCase()}</Text>
              <Text style={[styles.title, { color: colors.foreground }]}>Open work map</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close field route map"><Feather name="x" size={22} color={colors.mutedForeground} /></Pressable>
          </View>

          {located.length ? (
            <>
              <View style={[styles.map, { borderColor: colors.border, backgroundColor: colors.secondary }]}>
                <View style={[styles.mapLine, styles.lineOne, { backgroundColor: colors.border }]} />
                <View style={[styles.mapLine, styles.lineTwo, { backgroundColor: colors.border }]} />
                <View style={[styles.mapLine, styles.lineThree, { backgroundColor: colors.border }]} />
                <Text style={[styles.mapCaption, { color: colors.mutedForeground }]}>RELATIVE FIELD POSITIONS</Text>
                {located.map((task, index) => {
                  const left = 8 + ((task.longitude - minLongitude) / longRange) * 76;
                  const top = 16 + (1 - (task.latitude - minLatitude) / latRange) * 60;
                  return (
                    <Pressable
                      key={task.id}
                      testID={`map-pin-${task.id}`}
                      onPress={() => onOpenTask(task)}
                      accessibilityLabel={`Open ${task.task} on the field map`}
                      style={[styles.marker, { left: `${left}%`, top: `${top}%`, backgroundColor: index === 0 ? colors.accent : colors.primary }]}
                    >
                      <Text style={[styles.markerText, { color: index === 0 ? colors.accentForeground : colors.primaryForeground }]}>{index + 1}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={[styles.helper, { color: colors.mutedForeground }]}>{located.length} of {tasks.length} open task{tasks.length === 1 ? '' : 's'} have a saved GPS pin. Tap a marker for its task.</Text>
              {routeUrl ? <Pressable testID="open-month-route" onPress={() => void Linking.openURL(routeUrl)} style={[styles.routeButton, { backgroundColor: colors.primary }]} accessibilityRole="link">
                <Feather name="navigation" size={17} color={colors.primaryForeground} />
                <Text style={[styles.routeText, { color: colors.primaryForeground }]}>Open route in Google Maps</Text>
              </Pressable> : null}
            </>
          ) : (
            <View style={[styles.empty, { borderColor: colors.border, backgroundColor: colors.secondary }]}>
              <Feather name="map-pin" size={28} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No field pins yet</Text>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Open a task, choose Edit, then use current location to add a pin for this month’s route.</Text>
            </View>
          )}

          <ScrollView style={styles.stops} contentContainerStyle={styles.stopList}>
            {located.map((task, index) => <Pressable key={task.id} onPress={() => onOpenTask(task)} style={[styles.stop, { borderColor: colors.border }]}><View style={[styles.stopNumber, { backgroundColor: colors.muted }]}><Text style={[styles.stopNumberText, { color: colors.primary }]}>{index + 1}</Text></View><View style={styles.stopCopy}><Text numberOfLines={1} style={[styles.stopTitle, { color: colors.foreground }]}>{task.task}</Text><Text numberOfLines={1} style={[styles.stopMeta, { color: colors.mutedForeground }]}>{task.location || 'GPS pin'}</Text></View><Feather name="chevron-right" size={17} color={colors.mutedForeground} /></Pressable>)}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20, 28, 24, 0.38)' },
  sheet: { maxHeight: '90%', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, paddingBottom: 32, gap: 15 },
  grabber: { width: 42, height: 5, borderRadius: 99, alignSelf: 'center' },
  heading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  eyebrow: { fontSize: 10, letterSpacing: 1.3, fontWeight: '800' },
  title: { marginTop: 3, fontSize: 25, fontWeight: '800' },
  map: { height: 242, borderRadius: 18, borderWidth: 1, overflow: 'hidden', position: 'relative' },
  mapLine: { position: 'absolute', height: 1, opacity: 0.7 },
  lineOne: { width: '135%', left: '-16%', top: '29%', transform: [{ rotate: '-13deg' }] },
  lineTwo: { width: '130%', left: '-14%', top: '65%', transform: [{ rotate: '10deg' }] },
  lineThree: { height: '125%', width: 1, left: '58%', top: '-12%', transform: [{ rotate: '17deg' }] },
  mapCaption: { position: 'absolute', left: 14, top: 13, fontSize: 9, letterSpacing: 1.3, fontWeight: '800' },
  marker: { position: 'absolute', width: 31, height: 31, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,.75)' },
  markerText: { fontSize: 12, fontWeight: '800' },
  helper: { fontSize: 12, lineHeight: 17 },
  routeButton: { minHeight: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9 },
  routeText: { fontSize: 15, fontWeight: '800' },
  empty: { minHeight: 194, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '800' },
  emptyText: { fontSize: 13, lineHeight: 19, textAlign: 'center' },
  stops: { maxHeight: 180 },
  stopList: { gap: 8 },
  stop: { minHeight: 56, borderWidth: 1, borderRadius: 13, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 10 },
  stopNumber: { width: 27, height: 27, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  stopNumberText: { fontSize: 12, fontWeight: '800' },
  stopCopy: { flex: 1, gap: 2 },
  stopTitle: { fontSize: 14, fontWeight: '800' },
  stopMeta: { fontSize: 12 },
});