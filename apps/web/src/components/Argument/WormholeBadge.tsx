'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useV3SimilarNodes } from '@/hooks/useV3Subgraph';

interface WormholeBadgeProps {
  iNodeId: string;
}

export function WormholeBadge({ iNodeId }: WormholeBadgeProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const badgeRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  const { data, isLoading } = useV3SimilarNodes(activeNodeId);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isOpen) {
      setActiveNodeId(iNodeId);
      const rect = badgeRef.current?.getBoundingClientRect();
      if (rect) {
        const top = rect.bottom + window.scrollY + 4;
        let left = rect.left + window.scrollX - 120;
        if (left + 280 > window.innerWidth - 16) left = window.innerWidth - 296;
        if (left < 16) left = 16;
        setPosition({ top, left });
      }
    }
    setIsOpen(!isOpen);
  };

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        badgeRef.current && !badgeRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const similarNodes = data?.similar_nodes ?? [];

  return (
    <>
      <button
        ref={badgeRef}
        onClick={handleClick}
        className="inline-flex items-center justify-center ml-0.5 w-4 h-4 text-slate-400 hover:text-blue-500 dark:text-slate-500 dark:hover:text-blue-400 transition-colors"
        title="Find similar claims"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
      </button>

      {isOpen && createPortal(
        <div
          ref={popoverRef}
          className="absolute z-50 w-72 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 p-3 text-sm"
          style={{ top: position.top, left: position.left }}
        >
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
            Similar claims across the network
          </div>

          {isLoading && (
            <div className="py-4 text-center text-xs text-slate-400">
              Loading...
            </div>
          )}

          {!isLoading && similarNodes.length === 0 && (
            <div className="py-4 text-center text-xs text-slate-400">
              No similar claims found
            </div>
          )}

          {!isLoading && similarNodes.length > 0 && (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {similarNodes.map((node) => (
                <Link
                  key={node.i_node.id}
                  href={node.source_post_id ? `/post/${node.source_post_id}` : '#'}
                  className="block p-2 rounded hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                  onClick={() => setIsOpen(false)}
                >
                  <p className="text-xs text-slate-700 dark:text-slate-300 line-clamp-2">
                    {node.i_node.content}
                  </p>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-400 dark:text-slate-500">
                    <span>{(node.similarity * 100).toFixed(0)}% match</span>
                    {node.source_author && <span>by {node.source_author}</span>}
                    {node.source_title && (
                      <span className="truncate max-w-[120px]">in &ldquo;{node.source_title}&rdquo;</span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  );
}
