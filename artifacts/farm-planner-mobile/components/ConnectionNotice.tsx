import { Feather } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';

type Props = {
  title: string;
  message: string;
  onRetry: () => void;
  retrying?: boolean;
};

export function ConnectionNotice({ title, message, onRetry, retrying = false }: Props) {
  const colors = useColors();

  return (
    <View
      testID="mobile-connection-notice"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.container, { backgroundColor: colors.secondary, borderColor: colors.border }]}
    >
      <View style={styles.copy}>
        <View style={styles.heading}>
          <Feather name="wifi-off" size={16} color={colors.primary} />
          <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
        </View>
        <Text style={[styles.message, { color: colors.mutedForeground }]}>{message}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Retry connection"
        disabled={retrying}
        onPress={onRetry}
        style={({ pressed }) => [
          styles.retry,
          {
            borderColor: colors.primary,
            opacity: retrying ? 0.6 : pressed ? 0.7 : 1,
          },
        ]}
      >
        {retrying ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Text style={[styles.retryText, { color: colors.primary }]}>Retry</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  copy: { flex: 1, gap: 4 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  title: { flex: 1, fontSize: 13, fontWeight: '800' },
  message: { fontSize: 12, lineHeight: 18 },
  retry: {
    minWidth: 68,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  retryText: { fontSize: 12, fontWeight: '800' },
});