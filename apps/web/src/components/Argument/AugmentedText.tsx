'use client';

import { useState, useMemo, useCallback } from 'react';
import { InsightPopover } from './InsightPopover';
import { WormholeBadge } from './WormholeBadge';
import {
  filterSubgraphBySource,
  segmentTextV3,
  getConnectedSchemes,
  getExtractedValues,
} from '@/lib/v3Helpers';
import type { V3Subgraph, V3INode, V3EpistemicType } from '@chitin/shared';

interface AugmentedTextProps {
  text: string;
  sourceType: 'post' | 'reply';
  sourceId: string;
  subgraph: V3Subgraph;
  onINodeClick?: (iNode: V3INode, action: 'search' | 'reply') => void;
}

const epistemicUnderline: Record<V3EpistemicType, string> = {
  FACT: 'decoration-blue-500/50 dark:decoration-blue-400/50',
  VALUE: 'decoration-purple-500/50 dark:decoration-purple-400/50',
  POLICY: 'decoration-amber-500/50 dark:decoration-amber-400/50',
};

const epistemicHover: Record<V3EpistemicType, string> = {
  FACT: 'hover:bg-blue-50/50 dark:hover:bg-blue-900/20',
  VALUE: 'hover:bg-purple-50/50 dark:hover:bg-purple-900/20',
  POLICY: 'hover:bg-amber-50/50 dark:hover:bg-amber-900/20',
};

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

  const handleSpanClick = useCallback(
    (iNode: V3INode, e: React.MouseEvent<HTMLSpanElement>) => {
      const rect = (e.target as HTMLElement).getBoundingClientRect();
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
        const underline = epistemicUnderline[iNode.epistemic_type] ?? epistemicUnderline.FACT;
        const hover = epistemicHover[iNode.epistemic_type] ?? epistemicHover.FACT;

        return (
          <span key={`${iNode.id}-${idx}`}>
            <span
              className={`underline underline-offset-2 cursor-pointer transition-colors rounded-sm ${underline} ${hover}`}
              onClick={(e) => handleSpanClick(iNode, e)}
              data-testid={`v3-highlight-${iNode.epistemic_type.toLowerCase()}`}
            >
              {seg.text}
            </span>
            <WormholeBadge iNodeId={iNode.id} />
          </span>
        );
      })}

      {activeINode && anchorRect && (
        <InsightPopover
          iNode={activeINode}
          connectedSchemes={getConnectedSchemes(activeINode, subgraph)}
          extractedValues={getExtractedValues(activeINode.id, subgraph)}
          anchorRect={anchorRect}
          onClose={handlePopoverClose}
          onAction={handlePopoverAction}
        />
      )}
    </div>
  );
}
