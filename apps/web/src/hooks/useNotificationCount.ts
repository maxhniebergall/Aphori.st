import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { notificationsApi } from '@/lib/api';

export function useNotificationCount(): number {
  const { isAuthenticated, token } = useAuth();

  const { data } = useQuery({
    queryKey: ['notificationCount'],
    queryFn: () => notificationsApi.getNewCount(token!),
    enabled: isAuthenticated && !!token,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  return data?.count ?? 0;
}
