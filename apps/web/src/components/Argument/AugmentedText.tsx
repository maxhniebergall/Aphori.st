'use client';

import { useState, useMemo, useCallback } from 'react';
import { InsightPopover } from './InsightPopover';
import {
  filterSubgraphBySource,
  segmentTextV3,
  getExtractedValues,
  getUnsupportedINodeIds,
  getFallaciousINodeIds,
} from '@/lib/v3Helpers';
import type { V3Subgraph, V3INode } from '@chitin/shared';

interface AugmentedTextProps {
  text: string;
  sourceType: 'post' | 'reply';
  sourceId: string;
  subgraph: V3Subgraph;
  onINodeClick?: (iNode: V3INode, action: 'search' | 'reply') => void;
}

function getHighlightStyle(
  iNodeId: string,
  unsupportedIds: Set<string>,
  fallaciousIds: Map<string, { type: string; explanation: string }>
): { underline: string; hover: string } {
  if (fallaciousIds.has(iNodeId)) {
    return {
      underline: 'decoration-red-500/60',
      hover: 'hover:bg-red-50/50 dark:hover:bg-red-900/20',
    };
  }
  if (unsupportedIds.has(iNodeId)) {
    return {
      underline: 'decoration-yellow-400/70',
      hover: 'hover:bg-yellow-50/50 dark:hover:bg-yellow-900/20',
    };
  }
  return {
    underline: 'decoration-slate-300/60 dark:decoration-slate-600/60',
    hover: 'hover:bg-slate-50/50 dark:hover:bg-slate-800/30',
  };
}

export function AugmentedText({
  text,
  sourceType,
  sourceId,
  subgraph,
  onINodeClick,
}: AugmentedTextProps) {
  const [activeINode, setActiveINode] = useState<V3INode | null>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const iNodes = useMemo(
    () => filterSubgraphBySource(subgraph, sourceType, sourceId),
    [subgraph, sourceType, sourceId]
  );

  const segments = useMemo(
    () => segmentTextV3(text, iNodes),
    [text, iNodes]
  );

  const unsupportedIds = useMemo(() => getUnsupportedINodeIds(subgraph), [subgraph]);
  const fallaciousIds = useMemo(() => getFallaciousINodeIds(subgraph), [subgraph]);

  const handleSpanClick = useCallback(
    (iNode: V3INode, e: React.MouseEvent<HTMLSpanElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      setActiveINode(iNode);
      setAnchorRect(rect);
    },
    []
  );

  const handlePopoverClose = useCallback(() => {
    setActiveINode(null);
    setAnchorRect(null);
  }, []);

  const handlePopoverAction = useCallback(
    (action: 'search' | 'reply') => {
      if (activeINode && onINodeClick) {
        onINodeClick(activeINode, action);
      }
      handlePopoverClose();
    },
    [activeINode, onINodeClick, handlePopoverClose]
  );

  return (
    <div className="whitespace-pre-wrap text-sm leading-relaxed">
      {segments.map((seg, idx) => {
        if (!seg.iNode) {
          return <span key={idx}>{seg.text}</span>;
        }

        const iNode = seg.iNode;
        const { underline, hover } = getHighlightStyle(iNode.id, unsupportedIds, fallaciousIds);
        const highlightStatus = fallaciousIds.has(iNode.id)
          ? 'fallacious'
          : unsupportedIds.has(iNode.id)
          ? 'unsupported'
          : 'supported';

        return (
          <span
            key={`${iNode.id}-${idx}`}
            className={`underline underline-offset-2 cursor-pointer transition-colors rounded-sm ${underline} ${hover}`}
            onClick={(e) => handleSpanClick(iNode, e)}
            data-testid={`v3-highlight-${highlightStatus}`}
          >
            {seg.text}
          </span>
        );
      })}

      {activeINode && anchorRect && (
        <InsightPopover
          iNode={activeINode}
          extractedValues={getExtractedValues(activeINode.id, subgraph)}
          anchorRect={anchorRect}
          onClose={handlePopoverClose}
          onAction={handlePopoverAction}
          isUnsupported={unsupportedIds.has(activeINode.id)}
          fallacyInfo={fallaciousIds.get(activeINode.id)}
        />
      )}
    </div>
  );
}
