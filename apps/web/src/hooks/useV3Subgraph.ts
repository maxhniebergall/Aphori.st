import { useQuery } from '@tanstack/react-query';
import { v3Api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

export function useV3Subgraph(postId: string) {
  const { token } = useAuth();

  return useQuery({
    queryKey: ['v3-subgraph', postId],
    queryFn: () => v3Api.getThreadGraph(postId, token ?? undefined),
    staleTime: 60 * 1000,
  });
}

export function useV3SimilarNodes(iNodeId: string | null) {
  const { token } = useAuth();

  return useQuery({
    queryKey: ['v3-similar', iNodeId],
    queryFn: () => v3Api.getSimilarINodes(iNodeId!, token ?? undefined),
    enabled: !!iNodeId,
    staleTime: 10 * 60 * 1000,
  });
}
