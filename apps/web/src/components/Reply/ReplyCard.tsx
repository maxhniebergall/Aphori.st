'use client';

import { useState, useEffect } from 'react';
import { VoteButtons } from '@/components/Vote/VoteButtons';
import { ArgumentHighlights } from '@/components/Argument/ArgumentHighlights';
import { ReplyComposer } from './ReplyComposer';
import { formatDistanceToNow } from '@/lib/utils';
import { argumentApi, type ADU, type ADUCanonicalMapping } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import type { ReplyWithAuthor } from '@chitin/shared';

interface ReplyCardProps {
  reply: ReplyWithAuthor;
  postId: string;
  depth: number;
}

export function ReplyCard({ reply, postId, depth }: ReplyCardProps) {
  const { isAuthenticated } = useAuth();
  const [showReplyForm, setShowReplyForm] = useState(false);
  const [adus, setAdus] = useState<ADU[]>([]);
  const [canonicalMappings, setCanonicalMappings] = useState<ADUCanonicalMapping[]>([]);

  useEffect(() => {
    if (reply.analysis_status !== 'completed') return;

    let cancelled = false;
    Promise.all([
      argumentApi.getReplyADUs(reply.id),
      argumentApi.getCanonicalMappingsForReply(reply.id),
    ]).then(([adusData, mappingsData]) => {
      if (!cancelled) {
        setAdus(adusData);
        setCanonicalMappings(mappingsData);
      }
    }).catch((error) => {
      console.error('Failed to fetch reply argument data:', error);
    });

    return () => { cancelled = true; };
  }, [reply.id, reply.analysis_status]);

  return (
    <div className="p-4">
      <div className="flex gap-3">
        <VoteButtons
          targetType="reply"
          targetId={reply.id}
          score={reply.score}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-medium text-slate-700 dark:text-slate-300">
              {reply.author.display_name || reply.author.id}
            </span>
            {reply.author.user_type === 'agent' && (
              <span className="px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 rounded text-[10px] font-medium">
                BOT
              </span>
            )}
            <span>&middot;</span>
            <time dateTime={reply.created_at.toString()}>
              {formatDistanceToNow(new Date(reply.created_at))}
            </time>
          </div>

          {adus.length > 0 ? (
            <div className="mt-1 text-sm text-slate-700 dark:text-slate-300">
              <ArgumentHighlights
                text={reply.content}
                adus={adus}
                canonicalMappings={canonicalMappings}
                sourceId={reply.id}
              />
            </div>
          ) : (
            <p className="mt-1 text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
              {reply.content}
            </p>
          )}

          <div className="mt-2 flex items-center gap-4 text-xs">
            {isAuthenticated && depth < 10 && (
              <button
                onClick={() => setShowReplyForm(!showReplyForm)}
                className="text-slate-500 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400"
              >
                Reply
              </button>
            )}
            {reply.reply_count > 0 && (
              <span className="text-slate-500 dark:text-slate-400">
                {reply.reply_count} {reply.reply_count === 1 ? 'reply' : 'replies'}
              </span>
            )}
          </div>

          {showReplyForm && (
            <div className="mt-3">
              <ReplyComposer
                postId={postId}
                parentReplyId={reply.id}
                onSuccess={() => setShowReplyForm(false)}
                onCancel={() => setShowReplyForm(false)}
                compact
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
