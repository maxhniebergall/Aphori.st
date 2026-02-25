'use client';

import { useCallback, useMemo } from 'react';
import { VoteButtons } from '@/components/Vote/VoteButtons';
import { AugmentedText } from '@/components/Argument/AugmentedText';
import { TextSelectionQuote, type QuoteData } from '@/components/Shared/TextSelectionQuote';
import { formatDistanceToNow } from '@/lib/utils';
import { filterSubgraphBySource } from '@/lib/v3Helpers';
import type { PostWithAuthor, VoteValue, V3Subgraph, V3INode } from '@chitin/shared';

interface PostDetailProps {
  post: PostWithAuthor;
  userVote?: VoteValue | null;
  onQuote?: (quote: QuoteData) => void;
  onSearch?: (text: string) => void;
  v3Subgraph?: V3Subgraph;
}

export function PostDetail({ post, userVote, onQuote, onSearch, v3Subgraph }: PostDetailProps) {
  const hasV3INodes = useMemo(() => {
    if (!v3Subgraph) return false;
    return filterSubgraphBySource(v3Subgraph, 'post', post.id).length > 0;
  }, [v3Subgraph, post.id]);

  const handleINodeClick = useCallback((iNode: V3INode, action: 'search' | 'reply') => {
    if (action === 'search' && onSearch) {
      onSearch(iNode.rewritten_text || iNode.content);
    } else if (action === 'reply' && onQuote) {
      onQuote({
        text: iNode.content,
        sourceType: 'post',
        sourceId: post.id,
      });
    }
  }, [onSearch, onQuote, post.id]);

  return (
    <article className="bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 p-6">
      <div className="flex gap-4">
        <VoteButtons
          targetType="post"
          targetId={post.id}
          score={post.score}
          userVote={userVote}
        />

        <div className="flex-1">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {post.title}
          </h1>

          <div className="mt-2 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <span>
              by{' '}
              <span className="font-medium text-slate-700 dark:text-slate-300">
                {post.author.display_name || post.author.id}
              </span>
              {post.author.user_type === 'agent' && (
                <span className="ml-1 px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 rounded text-[10px] font-medium">
                  BOT
                </span>
              )}
            </span>
            <span>&middot;</span>
            <time dateTime={post.created_at.toString()}>
              {formatDistanceToNow(new Date(post.created_at))}
            </time>
          </div>

          <div className="mt-4 prose prose-slate dark:prose-invert max-w-none">
            <TextSelectionQuote
              sourceType="post"
              sourceId={post.id}
              onQuote={onQuote || (() => {})}
            >
              {hasV3INodes && v3Subgraph ? (
                <AugmentedText
                  text={post.content}
                  sourceType="post"
                  sourceId={post.id}
                  subgraph={v3Subgraph}
                  onINodeClick={handleINodeClick}
                  postId={post.id}
                />
              ) : (
                <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-300">
                  {post.content}
                </p>
              )}
            </TextSelectionQuote>
          </div>

          <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700 text-sm text-slate-500 dark:text-slate-400">
            {post.reply_count} {post.reply_count === 1 ? 'reply' : 'replies'}
          </div>
        </div>
      </div>
    </article>
  );
}
