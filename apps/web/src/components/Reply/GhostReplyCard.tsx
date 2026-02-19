'use client';

import { useState } from 'react';
import { ReplyComposer } from './ReplyComposer';
import { useAuth } from '@/contexts/AuthContext';
import type { V3Enthymeme, V3INode, V3SocraticQuestion } from '@chitin/shared';

interface GhostReplyCardProps {
  enthymeme: V3Enthymeme;
  parentINode: V3INode | null;
  socraticQuestions: V3SocraticQuestion[];
  postId: string;
  parentReplyId?: string;
  onReply?: () => void;
}

export function GhostReplyCard({
  enthymeme,
  parentINode,
  socraticQuestions,
  postId,
  parentReplyId,
  onReply,
}: GhostReplyCardProps) {
  const { isAuthenticated } = useAuth();
  const [showReplyForm, setShowReplyForm] = useState(false);

  return (
    <div className="p-4 mx-4 my-2 border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50/50 dark:bg-slate-800/30">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          Unstated assumption
        </span>
      </div>

      <p className="text-sm text-slate-700 dark:text-slate-300 italic">
        &ldquo;{enthymeme.content}&rdquo;
      </p>

      {/* Socratic questions */}
      {socraticQuestions.length > 0 && (
        <div className="mt-3 space-y-1">
          {socraticQuestions.map((q) => (
            <p key={q.id} className="text-xs text-slate-500 dark:text-slate-400 pl-3 border-l-2 border-slate-300 dark:border-slate-600">
              {q.question}
            </p>
          ))}
        </div>
      )}

      {/* Reply action */}
      {isAuthenticated && (
        <div className="mt-3">
          {!showReplyForm ? (
            <button
              onClick={() => setShowReplyForm(true)}
              className="text-xs text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 font-medium"
            >
              Reply to this assumption
            </button>
          ) : (
            <ReplyComposer
              postId={postId}
              parentReplyId={parentReplyId}
              quote={{
                text: enthymeme.content,
                sourceType: parentINode?.source_type ?? 'post',
                sourceId: parentINode?.source_id ?? postId,
              }}
              onSuccess={() => {
                setShowReplyForm(false);
                onReply?.();
              }}
              onCancel={() => setShowReplyForm(false)}
              compact
            />
          )}
        </div>
      )}
    </div>
  );
}
