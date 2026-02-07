'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { postsApi } from '@/lib/api';
import type { QuoteData } from '@/components/Shared/TextSelectionQuote';

interface ReplyComposerProps {
  postId: string;
  parentReplyId?: string;
  targetAduId?: string;
  quote?: QuoteData | null;
  onClearQuote?: () => void;
  onSuccess?: () => void;
  onCancel?: () => void;
  compact?: boolean;
}

export function ReplyComposer({
  postId,
  parentReplyId,
  targetAduId,
  quote,
  onClearQuote,
  onSuccess,
  onCancel,
  compact = false,
}: ReplyComposerProps) {
  const { isAuthenticated, token } = useAuth();
  const [content, setContent] = useState('');
  const queryClient = useQueryClient();

  const createReplyMutation = useMutation({
    mutationFn: async () => {
      if (!token) throw new Error('Not authenticated');
      return postsApi.createReply(
        postId,
        {
          content,
          parent_reply_id: parentReplyId,
          target_adu_id: quote?.targetAduId ?? targetAduId,
          ...(quote && {
            quoted_text: quote.text,
            quoted_source_type: quote.sourceType,
            quoted_source_id: quote.sourceId,
          }),
        },
        token
      );
    },
    onSuccess: () => {
      setContent('');
      onClearQuote?.();
      queryClient.invalidateQueries({ queryKey: ['replies', postId] });
      onSuccess?.();
    },
  });

  if (!isAuthenticated) {
    if (compact) return null;
    return (
      <div className="p-4 border-b border-slate-200 dark:border-slate-700 text-sm text-slate-500 dark:text-slate-400">
        Sign in to reply
      </div>
    );
  }

  return (
    <div className={compact ? '' : 'p-4 border-b border-slate-200 dark:border-slate-700'}>
      {quote && (
        <div className="mb-2 flex items-start gap-2 p-2 bg-slate-50 dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-700">
          <blockquote className="flex-1 pl-2 border-l-2 border-slate-300 dark:border-slate-600 text-xs text-slate-500 dark:text-slate-400 italic line-clamp-3">
            {quote.text}
          </blockquote>
          <button
            onClick={onClearQuote}
            className="shrink-0 p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            aria-label="Remove quote"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
      <textarea
        placeholder={parentReplyId ? 'Write a reply...' : 'Add a comment...'}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        maxLength={2000}
        rows={compact ? 2 : 3}
        className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:border-primary-500 dark:focus:border-primary-400 focus:outline-none resize-none"
      />

      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {content.length}/2000
        </span>

        <div className="flex gap-2">
          {onCancel && (
            <button
              onClick={onCancel}
              className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            >
              Cancel
            </button>
          )}
          <button
            onClick={() => createReplyMutation.mutate()}
            disabled={!content.trim() || createReplyMutation.isPending}
            className="px-3 py-1.5 text-xs font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {createReplyMutation.isPending ? 'Posting...' : 'Reply'}
          </button>
        </div>
      </div>

      {createReplyMutation.isError && (
        <p className="mt-2 text-xs text-red-500">
          Failed to post reply. Please try again.
        </p>
      )}
    </div>
  );
}
