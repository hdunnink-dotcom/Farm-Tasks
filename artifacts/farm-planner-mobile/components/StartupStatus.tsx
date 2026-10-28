import { Feather } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';

type StatusKind = 'loading' | 'configuration' | 'authentication' | 'api' | 'runtime';

type Props = {
  kind: StatusKind;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  busy?: boolean;
};

const iconByKind = {
  loading: 'loader',
  configuration: 'settings',
  authentication: 'lock',
  api: 'wifi-off',
  runtime: 'alert-triangle',
} as const;

export function StartupStatus({
  kind,
  title,
  message,
  actionLabel,
  onAction,
  busy = false,
}: Props) {
  const colors = useColors();
  const isLoading = kind === 'loading' && !onAction;

  return (
    <View
      testID={`startup-status-${kind}`}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <View style={[styles.icon, { backgroundColor: colors.secondary }]}>
        {isLoading ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Feather name={iconByKind[kind]} size={24} color={colors.primary} />
        )}
      </View>
      <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
      <Text style={[styles.message, { color: colors.mutedForeground }]}>{message}</Text>
      {onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel ?? 'Try again'}
          disabled={busy}
          onPress={onAction}
          style={({ pressed }) => [
            styles.action,
            {
              backgroundColor: colors.primary,
              opacity: busy ? 0.65 : pressed ? 0.82 : 1,
            },
          ]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.primaryForeground} />
          ) : (
            <Text style={[styles.actionText, { color: colors.primaryForeground }]}>
              {actionLabel ?? 'Try again'}
            </Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    gap: 12,
  },
  icon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  title: {
    fontSize: 21,
    lineHeight: 28,
    fontWeight: '800',
    textAlign: 'center',
  },
  message: {
    maxWidth: 360,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  action: {
    minWidth: 160,
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    marginTop: 8,
  },
  actionText: {
    fontSize: 15,
    fontWeight: '800',
  },
});