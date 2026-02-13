import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { votesApi } from '@/lib/api';
import type { VoteValue } from '@chitin/shared';

export function useUserVotes(
  targetType: 'post' | 'reply',
  targetIds: string[]
): Record<string, VoteValue> {
  const { isAuthenticated, token } = useAuth();

  const sortedIds = [...targetIds].sort();

  const { data } = useQuery({
    queryKey: ['userVotes', targetType, ...sortedIds],
    queryFn: () => votesApi.getUserVotes(targetType, sortedIds, token!),
    enabled: isAuthenticated && !!token && sortedIds.length > 0,
    staleTime: 2 * 60 * 1000,
  });

  return data ?? {};
}
