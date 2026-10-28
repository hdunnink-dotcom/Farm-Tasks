import { useSignIn } from '@clerk/expo/legacy';
import { type Href, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useColors } from '@/hooks/useColors';

export default function SignInScreen() {
  const colors = useColors();
  const router = useRouter();
  const { isLoaded, signIn, setActive } = useSignIn();
  const [emailAddress, setEmailAddress] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const signInWithPassword = async () => {
    if (!isLoaded || !signIn) return;
    setMessage('');
    setBusy(true);
    try {
      const attempt = await signIn.create({ identifier: emailAddress.trim(), password });
      if (attempt.status === 'complete' && attempt.createdSessionId) {
        await setActive({ session: attempt.createdSessionId });
        router.replace('/' as Href);
      } else {
        setMessage('Additional verification is required for this account.');
      }
    } catch (error) {
      const detail = error as { errors?: Array<{ longMessage?: string; message?: string }> };
      setMessage(detail.errors?.[0]?.longMessage || detail.errors?.[0]?.message || 'We could not sign you in with those details.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        <View style={[styles.mark, { backgroundColor: colors.primary }]}><Text style={[styles.markText, { color: colors.primaryForeground }]}>F</Text></View>
        <Text style={[styles.title, { color: colors.foreground }]}>Farm planner</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Sign in with your approved farm account to view work and attach field photos.</Text>

        <View style={styles.form}>
          <Text style={[styles.label, { color: colors.foreground }]}>Email address</Text>
          <TextInput value={emailAddress} onChangeText={setEmailAddress} autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder="you@example.com" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]} />
          <Text style={[styles.label, { color: colors.foreground }]}>Password</Text>
          <TextInput value={password} onChangeText={setPassword} autoComplete="password" secureTextEntry placeholder="Your password" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]} />
          {message ? <Text style={[styles.error, { color: colors.destructive }]}>{message}</Text> : null}
          <Pressable accessibilityRole="button" disabled={!emailAddress || !password || busy || !isLoaded} onPress={() => void signInWithPassword()} style={[styles.button, { backgroundColor: colors.primary }, (!emailAddress || !password || busy || !isLoaded) && styles.disabled]}>
            {busy ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>Sign in</Text>}
          </Pressable>
        </View>
        <Text style={[styles.footnote, { color: colors.mutedForeground }]}>Access is limited to approved farm members.</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: 24 },
  content: { width: '100%', maxWidth: 420, alignSelf: 'center' },
  mark: { width: 50, height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  markText: { fontSize: 25, fontWeight: '900' },
  title: { fontSize: 30, fontWeight: '800', letterSpacing: -0.6 },
  subtitle: { fontSize: 15, lineHeight: 22, marginTop: 9, marginBottom: 30 },
  form: { gap: 9 },
  label: { fontSize: 13, fontWeight: '800', marginTop: 5 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 13, paddingHorizontal: 14, fontSize: 15 },
  error: { fontSize: 13, lineHeight: 19, marginTop: 3 },
  button: { minHeight: 50, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  buttonText: { fontSize: 15, fontWeight: '800' },
  disabled: { opacity: 0.45 },
  footnote: { fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 22 },
});