'use client';

import { useState, useEffect, useMemo } from 'react';
import { ClaimDeduplicationBadge } from './ClaimDeduplicationBadge';
import { RelatedPostsList } from './RelatedPostsList';
import { argumentApi, type ADUCanonicalMapping, type RelatedSource } from '@/lib/api';

interface ADU {
  id: string;
  adu_type: 'claim' | 'premise';
  text: string;
  span_start: number;
  span_end: number;
  confidence: number;
}

interface Segment {
  text: string;
  adu?: ADU;
  canonicalMapping?: ADUCanonicalMapping;
}

interface ArgumentHighlightsProps {
  text: string;
  adus: ADU[];
  canonicalMappings?: ADUCanonicalMapping[];
  sourceId?: string;
  onADUClick?: (adu: ADU) => void;
}

function segmentText(
  text: string,
  adus: ADU[],
  canonicalMappings?: ADUCanonicalMapping[]
): Segment[] {
  // Create a lookup for canonical mappings by ADU ID
  const mappingsByAduId = new Map<string, ADUCanonicalMapping>();
  if (canonicalMappings) {
    for (const mapping of canonicalMappings) {
      mappingsByAduId.set(mapping.adu_id, mapping);
    }
  }

  // Sort ADUs by span_start, split text into segments
  const sorted = [...adus].sort((a, b) => a.span_start - b.span_start);
  const segments: Segment[] = [];
  let pos = 0;

  for (const adu of sorted) {
    if (pos < adu.span_start) {
      segments.push({ text: text.slice(pos, adu.span_start) });
    }
    segments.push({
      text: text.slice(adu.span_start, adu.span_end),
      adu,
      canonicalMapping: mappingsByAduId.get(adu.id),
    });
    pos = adu.span_end;
  }

  if (pos < text.length) {
    segments.push({ text: text.slice(pos) });
  }

  return segments;
}

export function ArgumentHighlights({
  text,
  adus,
  canonicalMappings,
  sourceId,
  onADUClick,
}: ArgumentHighlightsProps) {
  const [hoveredADU, setHoveredADU] = useState<string | null>(null);
  const [expandedADU, setExpandedADU] = useState<string | null>(null);
  const [relatedSources, setRelatedSources] = useState<RelatedSource[]>([]);
  const [isLoadingRelated, setIsLoadingRelated] = useState(false);

  // Memoize segments to avoid recreating on every render
  const segments = useMemo(
    () => segmentText(text, adus, canonicalMappings),
    [text, adus, canonicalMappings]
  );

  // Create a stable lookup map for canonical claim IDs by ADU ID
  const canonicalClaimIdByAduId = useMemo(() => {
    const map = new Map<string, string>();
    if (canonicalMappings) {
      for (const mapping of canonicalMappings) {
        if (mapping.adu_count > 1) {
          map.set(mapping.adu_id, mapping.canonical_claim_id);
        }
      }
    }
    return map;
  }, [canonicalMappings]);

  // Fetch related sources when a claim is expanded
  useEffect(() => {
    if (!expandedADU) {
      setRelatedSources([]);
      return;
    }

    const canonicalClaimId = canonicalClaimIdByAduId.get(expandedADU);

    if (!canonicalClaimId) {
      return;
    }

    let cancelled = false;
    setIsLoadingRelated(true);

    argumentApi
      .getRelatedPostsForCanonicalClaim(canonicalClaimId, 10, sourceId)
      .then((data) => {
        if (!cancelled) {
          setRelatedSources(data);
          setIsLoadingRelated(false);
        }
      })
      .catch((error) => {
        console.error('Failed to fetch related sources:', error);
        if (!cancelled) {
          setRelatedSources([]);
          setIsLoadingRelated(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [expandedADU, sourceId, canonicalClaimIdByAduId]);

  const handleClaimClick = (adu: ADU, mapping?: ADUCanonicalMapping) => {
    // Only toggle expansion for deduplicated claims
    if (mapping && mapping.adu_count > 1) {
      setExpandedADU(expandedADU === adu.id ? null : adu.id);
    }
    onADUClick?.(adu);
  };

  // Find the expanded segment for showing related posts inline
  const expandedSegmentIndex = segments.findIndex(
    s => s.adu?.id === expandedADU && s.canonicalMapping && s.canonicalMapping.adu_count > 1
  );

  return (
    <div className="whitespace-pre-wrap text-base leading-relaxed">
      {segments.map((seg, idx) => {
        if (!seg.adu) {
          return <span key={idx}>{seg.text}</span>;
        }

        const isClaim = seg.adu.adu_type === 'claim';
        const isHovered = hoveredADU === seg.adu.id;
        const isExpanded = expandedADU === seg.adu.id;
        const isDeduplicated = seg.canonicalMapping && seg.canonicalMapping.adu_count > 1;

        // Build tooltip
        let tooltip = `${isClaim ? 'Claim' : 'Premise'} (${(seg.adu.confidence * 100).toFixed(0)}%)`;
        if (seg.canonicalMapping && seg.canonicalMapping.representative_text !== seg.text) {
          tooltip += ` - Canonical: "${seg.canonicalMapping.representative_text}"`;
        }

        return (
          <span key={idx}>
            <span
              className={`
                border-b-2 transition-colors
                ${isDeduplicated ? 'cursor-pointer' : ''}
                ${isClaim
                  ? isHovered || isExpanded
                    ? 'border-blue-600/70 bg-blue-100/30 dark:border-blue-400/70 dark:bg-blue-900/20'
                    : 'border-blue-500/40 hover:bg-blue-50/30 dark:border-blue-400/40 dark:hover:bg-blue-900/15'
                  : isHovered
                    ? 'border-green-600/70 bg-green-100/50 dark:border-green-400/70 dark:bg-green-900/20'
                    : 'border-green-500/40 hover:bg-green-50/50 dark:border-green-400/40 dark:hover:bg-green-900/15'
                }
              `}
              onClick={() => handleClaimClick(seg.adu!, seg.canonicalMapping)}
              onMouseEnter={() => setHoveredADU(seg.adu!.id)}
              onMouseLeave={() => setHoveredADU(null)}
              title={tooltip}
            >
              {seg.text}
            </span>
            {isClaim && seg.canonicalMapping && (
              <ClaimDeduplicationBadge
                aduCount={seg.canonicalMapping.adu_count}
                isExpanded={isExpanded}
              />
            )}
            {/* Show related posts inline after the expanded claim */}
            {idx === expandedSegmentIndex && (
              <RelatedPostsList
                relatedSources={relatedSources}
                isLoading={isLoadingRelated}
              />
            )}
          </span>
        );
      })}
    </div>
  );
}
