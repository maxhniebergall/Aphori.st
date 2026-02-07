'use client';

import { useState, useEffect, useMemo } from 'react';
import { ClaimDeduplicationBadge } from './ClaimDeduplicationBadge';
import { RelatedPostsList } from './RelatedPostsList';
import { argumentApi, type ADUCanonicalMapping, type RelatedSource } from '@/lib/api';

// V2 Ontology ADU types
type ADUType = 'MajorClaim' | 'Supporting' | 'Opposing' | 'Evidence';

interface ADU {
  id: string;
  adu_type: ADUType;
  text: string;
  span_start: number;
  span_end: number;
  confidence: number;
  target_adu_id: string | null;
}

// Type colors for V2 ontology
const typeStyles: Record<ADUType, { base: string; hover: string; label: string }> = {
  MajorClaim: {
    base: 'border-blue-500/40 dark:border-blue-400/40',
    hover: 'border-blue-600/70 bg-blue-100/30 dark:border-blue-400/70 dark:bg-blue-900/20',
    label: 'Major Claim',
  },
  Supporting: {
    base: 'border-green-500/40 dark:border-green-400/40',
    hover: 'border-green-600/70 bg-green-100/50 dark:border-green-400/70 dark:bg-green-900/20',
    label: 'Supporting',
  },
  Opposing: {
    base: 'border-red-500/40 dark:border-red-400/40',
    hover: 'border-red-600/70 bg-red-100/50 dark:border-red-400/70 dark:bg-red-900/20',
    label: 'Opposing',
  },
  Evidence: {
    base: 'border-yellow-500/40 dark:border-yellow-400/40',
    hover: 'border-yellow-600/70 bg-yellow-100/50 dark:border-yellow-400/70 dark:bg-yellow-900/20',
    label: 'Evidence',
  },
};

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
  sourceType?: 'post' | 'reply';
  onADUClick?: (adu: ADU, action: 'search' | 'reply') => void;
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
  // NOTE: This function assumes non-overlapping ADU spans. If overlapping spans are introduced
  // in the future, this logic will need to be updated to handle them correctly.
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
  sourceType,
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

  // Lookup ADU by ID (for resolving target_adu_id on hover)
  const aduById = useMemo(() => {
    const map = new Map<string, ADU>();
    for (const adu of adus) {
      map.set(adu.id, adu);
    }
    return map;
  }, [adus]);

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
    if (onADUClick) {
      // MajorClaim and Evidence navigate to search; Supporting and Opposing open reply composer
      const action = (adu.adu_type === 'MajorClaim' || adu.adu_type === 'Evidence')
        ? 'search' as const
        : 'reply' as const;
      onADUClick(adu, action);
    }
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

        const aduType = seg.adu.adu_type;
        const style = typeStyles[aduType];
        const hoveredAdu = hoveredADU ? aduById.get(hoveredADU) : undefined;
        const isHovered = hoveredADU === seg.adu.id
          || (hoveredAdu?.target_adu_id === seg.adu.id);
        const isExpanded = expandedADU === seg.adu.id;
        // Evidence is not deduplicated, so it won't have canonical mappings
        const isDeduplicated = seg.canonicalMapping && seg.canonicalMapping.adu_count > 1;
        const canExpand = isDeduplicated && aduType !== 'Evidence';

        // Build tooltip
        let tooltip = `${style.label} (${(seg.adu.confidence * 100).toFixed(0)}%)`;
        if (seg.canonicalMapping && seg.canonicalMapping.representative_text !== seg.text) {
          tooltip += ` - Canonical: "${seg.canonicalMapping.representative_text}"`;
        }
        if (seg.adu.target_adu_id) {
          tooltip += ' - targets another ADU';
        }

        return (
          <span key={`segment-${idx}-${seg.adu?.id || 'text'}`}>
            <span
              className={`
                border-b-2 transition-colors
                ${(canExpand || onADUClick) ? 'cursor-pointer' : ''}
                ${isHovered || isExpanded ? style.hover : `${style.base} hover:bg-opacity-50`}
              `}
              data-testid={`highlight-${aduType.toLowerCase()}`}
              onClick={() => handleClaimClick(seg.adu!, seg.canonicalMapping)}
              onMouseEnter={() => setHoveredADU(seg.adu!.id)}
              onMouseLeave={() => setHoveredADU(null)}
              title={tooltip}
            >
              {seg.text}
            </span>
            {/* Show deduplication badge for all deduplicatable types (not Evidence) */}
            {aduType !== 'Evidence' && seg.canonicalMapping && (
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
