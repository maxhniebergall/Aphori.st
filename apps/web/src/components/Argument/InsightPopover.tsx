'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { V3INode, V3ExtractedValue } from '@chitin/shared';

interface InsightPopoverProps {
  iNode: V3INode;
  extractedValues: V3ExtractedValue[];
  anchorRect: DOMRect;
  onClose: () => void;
  onAction: (action: 'search' | 'reply') => void;
}

export function InsightPopover({
  iNode,
  extractedValues,
  anchorRect,
  onClose,
  onAction,
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

      {/* Context-free rewrite if different */}
      {iNode.rewritten_text && iNode.rewritten_text !== iNode.content && (
        <p className="mb-3 text-[10px] text-slate-500 dark:text-slate-400 italic">
          Context-free: &ldquo;{iNode.rewritten_text}&rdquo;
        </p>
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
        <button
          onClick={() => onAction('search')}
          className="flex-1 px-2 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded transition-colors"
        >
          Search similar
        </button>
        <button
          onClick={() => onAction('reply')}
          className="flex-1 px-2 py-1.5 text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 rounded transition-colors"
        >
          Reply to this
        </button>
      </div>
    </div>,
    document.body
  );
}
