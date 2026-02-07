'use client';

import { useEffect, useState } from 'react';
import { VoteButtons } from '@/components/Vote/VoteButtons';
import { ArgumentHighlights } from '@/components/Argument/ArgumentHighlights';
import { formatDistanceToNow } from '@/lib/utils';
import { argumentApi, type ADU, type ADUCanonicalMapping } from '@/lib/api';
import type { PostWithAuthor } from '@chitin/shared';

interface PostDetailProps {
  post: PostWithAuthor;
}

export function PostDetail({ post }: PostDetailProps) {
  const [adus, setAdus] = useState<ADU[]>([]);
  const [canonicalMappings, setCanonicalMappings] = useState<ADUCanonicalMapping[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchArgumentData() {
      try {
        // Fetch ADUs and canonical mappings in parallel
        const [adusData, mappingsData] = await Promise.all([
          argumentApi.getPostADUs(post.id),
          argumentApi.getCanonicalMappingsForPost(post.id),
        ]);
        setAdus(adusData);
        setCanonicalMappings(mappingsData);
      } catch (error) {
        console.error('Failed to fetch argument data:', error);
      } finally {
        setIsLoading(false);
      }
    }

    if (post.analysis_status === 'completed') {
      fetchArgumentData();
    } else {
      setIsLoading(false);
    }
  }, [post.id, post.analysis_status]);

  return (
    <article className="bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 p-6">
      <div className="flex gap-4">
        <VoteButtons
          targetType="post"
          targetId={post.id}
          score={post.score}
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
            {!isLoading && adus.length > 0 ? (
              <ArgumentHighlights
                text={post.content}
                adus={adus}
                canonicalMappings={canonicalMappings}
                sourceId={post.id}
              />
            ) : (
              <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-300">
                {post.content}
              </p>
            )}
          </div>

          {!isLoading && adus.length > 0 && (
            <div className="mt-3 flex items-center flex-wrap gap-4 text-xs text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-0.5 bg-blue-500 dark:bg-blue-400" />
                Claim
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-0.5 bg-green-500 dark:bg-green-400" />
                Premise
              </span>
              {canonicalMappings.some(m => m.adu_count > 1) && (
                <span className="flex items-center gap-1">
                  <span className="inline-flex items-center justify-center w-4 h-4 text-[9px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 rounded-full">
                    +N
                  </span>
                  Also in other posts (click to explore)
                </span>
              )}
            </div>
          )}

          <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700 text-sm text-slate-500 dark:text-slate-400">
            {post.reply_count} {post.reply_count === 1 ? 'reply' : 'replies'}
          </div>
        </div>
      </div>
    </article>
  );
}
