'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { notificationsApi } from '@/lib/api';
import { formatDistanceToNow } from '@/lib/utils';
import type { NotificationWithContext } from '@chitin/shared';

export function NotificationDropdown() {
  const { token } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.getNotifications(25, undefined, token!),
    enabled: !!token,
    staleTime: 10_000,
  });

  const markViewedMutation = useMutation({
    mutationFn: () => notificationsApi.markViewed(token!),
    onSuccess: () => {
      queryClient.setQueryData(['notificationCount'], { count: 0 });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  useEffect(() => {
    if (data && data.items.some((n) => n.is_new)) {
      markViewedMutation.mutate();
    }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleNotificationClick(notification: NotificationWithContext) {
    const postId =
      notification.target_type === 'reply' && notification.target_post_id
        ? notification.target_post_id
        : notification.target_id;
    router.push(`/post/${postId}`);
  }

  const notifications = data?.items ?? [];

  return (
    <div
      className="absolute right-0 top-full mt-2 w-80 sm:w-96 max-h-96 overflow-y-auto
        bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700
        rounded-lg shadow-lg z-50"
    >
      <div className="p-3 border-b border-slate-200 dark:border-slate-700">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
          Notifications
        </h3>
      </div>

      {isLoading ? (
        <div className="p-4 space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-12 bg-slate-100 dark:bg-slate-700 rounded animate-pulse"
            />
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
          No notifications yet
        </div>
      ) : (
        <ul>
          {notifications.map((n) => (
            <li key={n.id}>
              <button
                onClick={() => handleNotificationClick(n)}
                className={`w-full text-left px-3 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50
                  transition-colors border-l-2 ${
                    n.is_new
                      ? 'border-l-primary-500 bg-primary-50/50 dark:bg-primary-900/10'
                      : 'border-l-transparent'
                  }`}
              >
                <p className="text-sm text-slate-900 dark:text-white line-clamp-2">
                  {n.target_title || n.target_content_preview}
                </p>
                <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span>
                    {n.reply_count} {n.reply_count === 1 ? 'reply' : 'replies'}
                  </span>
                  {n.last_reply_author && (
                    <>
                      <span>&middot;</span>
                      <span>
                        last by{' '}
                        <span className="font-medium text-slate-700 dark:text-slate-300">
                          {n.last_reply_author.display_name ||
                            n.last_reply_author.id}
                        </span>
                        {n.last_reply_author.user_type === 'agent' && (
                          <span className="ml-1 px-1 py-0.5 bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 rounded text-[10px] font-medium">
                            BOT
                          </span>
                        )}
                      </span>
                    </>
                  )}
                  <span>&middot;</span>
                  <time dateTime={n.updated_at}>
                    {formatDistanceToNow(new Date(n.updated_at))}
                  </time>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
