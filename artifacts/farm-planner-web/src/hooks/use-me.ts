import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@clerk/react';
import { customFetch } from '@workspace/api-client-react';
import { AUTH_DISABLED } from '@/lib/auth-config';

export interface MeResponse {
  clerkId: string;
  role: string;
  isManager: boolean;
  isHarnold: boolean;
}

export function apiErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('status' in error)) return null;
  return typeof error.status === 'number' ? error.status : null;
}

export function shouldRetryMeRequest(failureCount: number, error: unknown): boolean {
  const status = apiErrorStatus(error);
  // Clerk can still be renewing an idle browser session when the first
  // protected request runs after an Android shortcut is resumed.
  if (status === 401) return failureCount < 2;
  if (status === 403) return false;
  return failureCount < 2;
}

export function useMe(enabled = true) {
  const { userId } = useAuth();
  const accountIdentity = AUTH_DISABLED ? 'test-master' : userId;

  return useQuery({
    queryKey: ['me', accountIdentity ?? 'signed-out'],
    enabled: enabled && (AUTH_DISABLED || Boolean(userId)),
    queryFn: async () => {
      const me = await customFetch<MeResponse>('/api/me');
      if (!me) throw new Error('The server returned no user context.');
      return me;
    },
    retry: shouldRetryMeRequest,
    retryDelay: (attemptIndex) => Math.min(500 * (2 ** attemptIndex), 2000),
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    staleTime: 5 * 60 * 1000,
  });
}
