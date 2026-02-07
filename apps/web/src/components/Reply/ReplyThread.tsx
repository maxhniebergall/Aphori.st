'use client';

import { useQuery } from '@tanstack/react-query';
import { postsApi } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { ReplyCard } from './ReplyCard';
import type { QuoteData } from '@/components/Shared/TextSelectionQuote';
import type { ReplyWithAuthor, PaginatedResponse } from '@chitin/shared';

interface ReplyThreadProps {
  postId: string;
  initialReplies: PaginatedResponse<ReplyWithAuthor>;
  onQuote?: (quote: QuoteData) => void;
  onSearch?: (text: string) => void;
}

export function ReplyThread({ postId, initialReplies, onQuote, onSearch }: ReplyThreadProps) {
  const { token } = useAuth();

  const { data } = useQuery({
    queryKey: ['replies', postId],
    queryFn: () => postsApi.getReplies(postId, 100, undefined, token ?? undefined),
    initialData: initialReplies,
    staleTime: 30 * 1000,
  });

  const replies = data?.items ?? [];

  if (replies.length === 0) {
    return (
      <div className="p-8 text-center text-slate-500 dark:text-slate-400">
        No replies yet. Be the first to reply!
      </div>
    );
  }

  // Build a tree structure from flat replies
  const rootReplies: ReplyWithAuthor[] = [];

  for (const reply of replies) {
    if (!reply.parent_reply_id) {
      rootReplies.push(reply);
    }
  }

  // TODO: Optimize rendering from O(n²) to O(n) by building a Map<parentId, children[]> once
  // and using it in getChildren() instead of filtering all replies for every node
  const getChildren = (parentId: string): ReplyWithAuthor[] => {
    return replies.filter((r) => r.parent_reply_id === parentId);
  };

  const renderReply = (reply: ReplyWithAuthor, depth: number = 0) => {
    const children = getChildren(reply.id);

    return (
      <div key={reply.id}>
        <ReplyCard reply={reply} postId={postId} depth={depth} onQuote={onQuote} onSearch={onSearch} />
        {children.length > 0 && (
          <div className="ml-4 border-l-2 border-slate-200 dark:border-slate-700">
            {children.map((child) => renderReply(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="divide-y divide-slate-200 dark:divide-slate-700">
      {rootReplies.map((reply) => renderReply(reply))}
    </div>
  );
}
