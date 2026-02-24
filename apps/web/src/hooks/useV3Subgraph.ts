import { useQuery } from '@tanstack/react-query';
import { v3Api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

export function useV3Subgraph(postId: string) {
  const { token } = useAuth();

  return useQuery({
    queryKey: ['v3-subgraph', postId],
    queryFn: async () => {
      const result = await v3Api.getThreadGraph(postId, token ?? undefined);
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[V3] subgraph for ${postId}:`, {
          i_nodes: result.i_nodes?.length ?? 0,
          s_nodes: result.s_nodes?.length ?? 0,
          edges: result.edges?.length ?? 0,
        });
      }
      return result;
    },
    staleTime: 60 * 1000,
    retry: 2,
    meta: { errorMessage: `Failed to fetch V3 subgraph for post ${postId}` },
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
