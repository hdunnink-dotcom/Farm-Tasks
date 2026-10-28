import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import { useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

export type LocalAttachment = {
  uri: string;
  name: string;
  size?: number;
  contentType: string;
};

type Props = {
  onPicked: (files: LocalAttachment[]) => void;
  disabled?: boolean;
  compact?: boolean;
};

const extensionForType = (contentType: string) => contentType.split('/')[1]?.split(';')[0] || 'jpg';

function imageToAttachment(asset: ImagePicker.ImagePickerAsset, index: number): LocalAttachment {
  const contentType = asset.mimeType || 'image/jpeg';
  return {
    uri: asset.uri,
    name: asset.fileName || `field-photo-${Date.now()}-${index}.${extensionForType(contentType)}`,
    size: asset.fileSize,
    contentType,
  };
}

export function AttachmentPicker({ onPicked, disabled = false, compact = false }: Props) {
  const colors = useColors();
  const [busy, setBusy] = useState(false);

  const permissionAlert = (kind: 'camera' | 'photos', canAskAgain: boolean) => {
    if (canAskAgain) {
      Alert.alert(
        `${kind === 'camera' ? 'Camera' : 'Photo'} access needed`,
        `Allow access to ${kind === 'camera' ? 'take a photo' : 'choose a photo'} for this task.`,
      );
      return;
    }
    Alert.alert(
      `${kind === 'camera' ? 'Camera' : 'Photo'} access is off`,
      `Enable ${kind === 'camera' ? 'camera' : 'photo library'} access in device settings to attach a photo.`,
      [
        { text: 'Not now', style: 'cancel' },
        ...(Platform.OS !== 'web' ? [{ text: 'Open Settings', onPress: () => { void Linking.openSettings(); } }] : []),
      ],
    );
  };

  const pick = async (mode: 'camera' | 'gallery' | 'file') => {
    if (disabled || busy) return;
    setBusy(true);
    try {
      if (mode === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          permissionAlert('camera', permission.canAskAgain);
          return;
        }
        const result = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          quality: 0.85,
        });
        if (!result.canceled) onPicked(result.assets.map(imageToAttachment));
        return;
      }

      if (mode === 'gallery') {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          permissionAlert('photos', permission.canAskAgain);
          return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsMultipleSelection: true,
          quality: 0.85,
        });
        if (!result.canceled) onPicked(result.assets.map(imageToAttachment));
        return;
      }

      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (!result.canceled) {
        onPicked(result.assets.map((asset) => ({
          uri: asset.uri,
          name: asset.name,
          size: asset.size,
          contentType: asset.mimeType || 'application/octet-stream',
        })));
      }
    } catch (error) {
      Alert.alert('Could not choose that attachment', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.row, compact && styles.compactRow]}>
      <Pressable
        testID="attachment-take-photo"
        accessibilityRole="button"
        accessibilityLabel="Take photo"
        disabled={disabled || busy}
        onPress={() => void pick('camera')}
        style={[styles.action, compact && styles.compactAction, { backgroundColor: colors.secondary, borderColor: colors.border }, (disabled || busy) && styles.disabled]}
      >
        <Feather name="camera" size={compact ? 15 : 17} color={colors.primary} />
        <Text style={[styles.actionText, { color: colors.primary }]}>{compact ? 'Field photo' : 'Take field photo'}</Text>
      </Pressable>
      <Pressable
        testID="attachment-choose-photo"
        accessibilityRole="button"
        accessibilityLabel="Choose photo"
        disabled={disabled || busy}
        onPress={() => void pick('gallery')}
        style={[styles.action, compact && styles.compactAction, { backgroundColor: colors.secondary, borderColor: colors.border }, (disabled || busy) && styles.disabled]}
      >
        <Feather name="image" size={compact ? 15 : 17} color={colors.primary} />
        <Text style={[styles.actionText, { color: colors.primary }]}>{compact ? 'Gallery' : 'Choose photo'}</Text>
      </Pressable>
      <Pressable
        testID="attachment-choose-file"
        accessibilityRole="button"
        accessibilityLabel="Choose file"
        disabled={disabled || busy}
        onPress={() => void pick('file')}
        style={[styles.action, compact && styles.compactAction, { backgroundColor: colors.muted, borderColor: colors.border }, (disabled || busy) && styles.disabled]}
      >
        <Feather name="paperclip" size={compact ? 15 : 17} color={colors.mutedForeground} />
        <Text style={[styles.actionText, { color: colors.mutedForeground }]}>{compact ? 'File' : 'Choose file'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  compactRow: { marginTop: 1 },
  action: { minHeight: 44, borderWidth: 1, borderRadius: 13, paddingHorizontal: 11, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, flexGrow: 1 },
  compactAction: { minHeight: 34, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 6, flexGrow: 0 },
  actionText: { fontSize: 12, fontWeight: '800' },
  disabled: { opacity: 0.45 },
});