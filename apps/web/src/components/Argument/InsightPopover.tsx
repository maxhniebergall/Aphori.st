'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import type { V3INode, V3ExtractedValue } from '@chitin/shared';

interface InsightPopoverProps {
  iNode: V3INode;
  extractedValues: V3ExtractedValue[];
  anchorRect: DOMRect;
  onClose: () => void;
  onAction: (action: 'search' | 'reply') => void;
  isUnsupported?: boolean;
  isAttacked?: boolean;
  fallacyInfo?: { type: string; explanation: string };
  postId?: string;
}

export function InsightPopover({
  iNode,
  extractedValues,
  anchorRect,
  onClose,
  onAction,
  isUnsupported,
  isAttacked,
  fallacyInfo,
  postId,
}: InsightPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    const top = anchorRect.bottom + window.scrollY + 8;
    let left = anchorRect.left + window.scrollX;
    // Keep popover within viewport
    const popoverWidth = 320;
    if (left + popoverWidth > window.innerWidth - 16) {
      left = window.innerWidth - popoverWidth - 16;
    }
    if (left < 16) left = 16;
    setPosition({ top, left });
  }, [anchorRect]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  const replyButtonLabel = 'Reply to this';

  return createPortal(
    <div
      ref={popoverRef}
      className="absolute z-50 w-80 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 p-4 text-sm"
      style={{ top: position.top, left: position.left }}
    >
      {/* Original clicked text – always shown */}
      <p className="mb-2 text-xs text-slate-700 dark:text-slate-200 italic font-medium">
        &ldquo;{iNode.content}&rdquo;
      </p>

      {/* Fallacy banner – red, shown when a logical issue is detected */}
      {fallacyInfo && (
        <div className="mb-3 p-2 bg-red-50 dark:bg-red-900/20 rounded border border-red-200 dark:border-red-800">
          <p className="text-xs font-semibold text-red-700 dark:text-red-300">
            {fallacyInfo.type === 'EQUIVOCATION'
              ? '⚠ Equivocation detected'
              : `⚠ Logical issue detected: ${fallacyInfo.type.replace(/_/g, ' ')}`}
          </p>
          {fallacyInfo.explanation && (
            <p className="text-xs text-red-600 dark:text-red-400 mt-1 italic">
              {fallacyInfo.explanation}
            </p>
          )}
        </div>
      )}

      {/* Missing evidence banner – yellow, shown when claim has no supporting premises */}
      {isUnsupported && !fallacyInfo && (
        <div className="mb-3 p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded border border-yellow-200 dark:border-yellow-800">
          <p className="text-xs font-semibold text-yellow-800 dark:text-yellow-200">
            This claim currently lacks supporting evidence.
          </p>
        </div>
      )}

      {/* Attacked banner – orange, shown when claim has been challenged */}
      {isAttacked && !fallacyInfo && (
        <div className="mb-3 p-2 bg-orange-50 dark:bg-orange-900/20 rounded border border-orange-200 dark:border-orange-800">
          <p className="text-xs font-semibold text-orange-800 dark:text-orange-200">
            ⚔ This claim has been challenged.
          </p>
        </div>
      )}

      {/* Extracted values */}
      {extractedValues.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1">
          {extractedValues.map((v) => (
            <span
              key={v.id}
              className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded text-[10px]"
            >
              {v.text}
            </span>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
        <Link
          href={`/investigate/${iNode.id}?postId=${postId ?? ''}`}
          onClick={onClose}
          className="flex-1 px-2 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded transition-colors text-center"
        >
          Investigate
        </Link>
        <button
          onClick={() => onAction('reply')}
          className="flex-1 px-2 py-1.5 text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 rounded transition-colors"
        >
          {replyButtonLabel}
        </button>
      </div>
    </div>,
    document.body
  );
}
