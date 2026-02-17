'use client';

import { useState } from 'react';
import { ReplyComposer } from './ReplyComposer';
import { useAuth } from '@/contexts/AuthContext';
import type { V3Enthymeme, V3SNode, V3INode, V3SocraticQuestion } from '@chitin/shared';

interface GhostReplyCardProps {
  enthymeme: V3Enthymeme;
  sNode: V3SNode;
  parentINode: V3INode | null;
  socraticQuestions: V3SocraticQuestion[];
  postId: string;
  parentReplyId?: string;
  onReply?: () => void;
}

const fvpColors: Record<string, string> = {
  FACT: 'text-blue-600 dark:text-blue-400',
  VALUE: 'text-purple-600 dark:text-purple-400',
  POLICY: 'text-amber-600 dark:text-amber-400',
};

export function GhostReplyCard({
  enthymeme,
  sNode,
  parentINode,
  socraticQuestions,
  postId,
  parentReplyId,
  onReply,
}: GhostReplyCardProps) {
  const { isAuthenticated } = useAuth();
  const [showReplyForm, setShowReplyForm] = useState(false);

  const fvpColor = fvpColors[enthymeme.fvp_type] ?? fvpColors.FACT;

  return (
    <div className="p-4 mx-4 my-2 border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50/50 dark:bg-slate-800/30">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          Unstated assumption
        </span>
        <span className={`text-[10px] font-medium ${fvpColor}`}>
          {enthymeme.fvp_type}
        </span>
        <span className="ml-auto text-[10px] text-slate-400 dark:text-slate-500">
          {(enthymeme.probability * 100).toFixed(0)}% likely
        </span>
      </div>

      <p className="text-sm text-slate-700 dark:text-slate-300 italic">
        &ldquo;{enthymeme.content}&rdquo;
      </p>

      {/* Scheme info */}
      <div className="mt-2 flex items-center gap-2 text-[10px] text-slate-400 dark:text-slate-500">
        <span className={`px-1 py-0.5 rounded ${
          sNode.direction === 'SUPPORT'
            ? 'bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400'
            : 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400'
        }`}>
          {sNode.direction}
        </span>
        {sNode.logic_type && <span>{sNode.logic_type}</span>}
        {sNode.gap_detected && (
          <span className="px-1 py-0.5 bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300 rounded font-medium">
            GAP
          </span>
        )}
      </div>

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
