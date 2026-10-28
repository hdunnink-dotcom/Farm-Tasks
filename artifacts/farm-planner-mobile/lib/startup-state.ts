export type StartupConfiguration = {
  kind: 'configuration';
  title: string;
  message: string;
};

export function describeMobileConfiguration(input: {
  domain?: string | null;
  publishableKey?: string | null;
  authDisabled: boolean;
}): StartupConfiguration | null {
  if (!input.domain?.trim()) {
    return {
      kind: 'configuration',
      title: 'The planner server is not configured',
      message:
        'This mobile build does not know where to find the planner. Restart the mobile workflow and open a fresh phone preview.',
    };
  }

  if (!input.authDisabled && !input.publishableKey?.trim()) {
    return {
      kind: 'configuration',
      title: 'Sign-in is not configured',
      message:
        'This mobile build is missing its sign-in configuration. Restart the mobile workflow and open a fresh phone preview.',
    };
  }

  return null;
}

export function describeRuntimeError(error: unknown): {
  title: string;
  message: string;
} {
  const message = error instanceof Error ? error.message : String(error ?? '');

  if (/metro|bundle|unable to resolve|module map|javascript/i.test(message)) {
    return {
      title: 'The mobile bundle could not load',
      message:
        'The Expo preview did not receive a usable JavaScript bundle. Reopen the phone preview and scan a fresh QR code.',
    };
  }

  return {
    title: 'The planner could not open',
    message:
      'The app hit an unexpected startup error. Try reloading once, then reopen the phone preview if it continues.',
  };
}