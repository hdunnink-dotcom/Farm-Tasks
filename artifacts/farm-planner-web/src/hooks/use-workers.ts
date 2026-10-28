import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@clerk/react';
import { customFetch } from '@workspace/api-client-react';
import { AUTH_DISABLED } from '@/lib/auth-config';

export interface Worker {
  clerkId: string;
  displayName: string;
  status: string;
}

export function useWorkers(enabled = true) {
  const { userId } = useAuth();
  const accountIdentity = AUTH_DISABLED ? 'test-master' : userId;

  return useQuery({
    queryKey: ['workers', accountIdentity ?? 'signed-out'],
    enabled: enabled && (AUTH_DISABLED || Boolean(userId)),
    queryFn: async () => {
      const workers = await customFetch<Worker[]>('/api/team');
      if (!workers) throw new Error('The server returned no crew roster.');
      return workers;
    },
    staleTime: 5 * 60 * 1000,
  });
}
