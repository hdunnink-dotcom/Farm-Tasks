import React, { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { StartupStatus } from '@/components/StartupStatus';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { ClerkProvider, useAuth } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { setAuthTokenGetter, setBaseUrl } from '@workspace/api-client-react';
import { getListFarmTasksQueryKey, useListFarmTasks } from '@workspace/api-client-react';
import { AUTH_DISABLED } from '@/lib/auth-config';
import { AccountIdentityProvider } from '@/hooks/useAccountIdentity';
import { describeMobileConfiguration } from '@/lib/startup-state';
import { reloadAppAsync } from 'expo';

const domain = process.env.EXPO_PUBLIC_DOMAIN;
if (domain) setBaseUrl(`https://${domain}`);
const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
const proxyUrl = process.env.EXPO_PUBLIC_CLERK_PROXY_URL || undefined;
const configurationIssue = describeMobileConfiguration({
  domain,
  publishableKey,
  authDisabled: AUTH_DISABLED,
});
const AUTH_STARTUP_TIMEOUT_MS = 12_000;

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerBackTitle: 'Back' }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)/sign-in" options={{ headerShown: false }} />
    </Stack>
  );
}

function PlannerProviders({ accountIdentity }: { accountIdentity: string | null }) {
  return (
    <AccountIdentityProvider value={accountIdentity}>
      <QueryClientProvider client={queryClient}>
        <PlannerTaskRefresh accountIdentity={accountIdentity} />
        <GestureHandlerRootView style={styles.root}>
          <KeyboardProvider>
            <RootLayoutNav />
          </KeyboardProvider>
        </GestureHandlerRootView>
      </QueryClientProvider>
    </AccountIdentityProvider>
  );
}

function PlannerTaskRefresh({ accountIdentity }: { accountIdentity: string | null }) {
  useListFarmTasks({ includeDone: true }, {
    query: {
      queryKey: [...getListFarmTasksQueryKey({ includeDone: true }), accountIdentity],
      enabled: Boolean(accountIdentity),
      staleTime: 30_000,
      refetchInterval: 30_000,
    },
  });
  return null;
}

function AuthenticatedPlannerProviders() {
  const { getToken, userId, isLoaded } = useAuth();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!isLoaded) {
      setAuthTokenGetter(null);
      return;
    }
    setAuthTokenGetter(() => getToken());
    return () => setAuthTokenGetter(null);
  }, [getToken, isLoaded]);

  useEffect(() => {
    if (isLoaded) {
      setTimedOut(false);
      return;
    }

    const timeout = setTimeout(() => setTimedOut(true), AUTH_STARTUP_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [isLoaded]);

  if (!isLoaded) {
    return (
      <StartupStatus
        kind={timedOut ? 'authentication' : 'loading'}
        title={timedOut ? 'Sign-in is taking too long' : 'Connecting to sign-in'}
        message={
          timedOut
            ? 'The sign-in service did not respond. Check your connection and try again.'
            : 'The planner is securely checking your session. This normally takes only a few seconds.'
        }
        actionLabel={timedOut ? 'Reload planner' : undefined}
        onAction={timedOut ? () => void reloadAppAsync() : undefined}
      />
    );
  }

  return <PlannerProviders accountIdentity={userId ?? null} />;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        {configurationIssue ? (
          <StartupStatus
            kind={configurationIssue.kind}
            title={configurationIssue.title}
            message={configurationIssue.message}
          />
        ) : AUTH_DISABLED ? (
          <PlannerProviders accountIdentity="test-master" />
        ) : publishableKey ? (
          <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache} proxyUrl={proxyUrl}>
            <AuthenticatedPlannerProviders />
          </ClerkProvider>
        ) : (
          <StartupStatus
            kind="configuration"
            title="Sign-in is not configured"
            message="Restart the mobile workflow and open a fresh phone preview."
          />
        )}
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
