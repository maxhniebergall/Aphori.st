'use client';

import { useState, useMemo } from 'react';
import { ClaimDeduplicationBadge } from './ClaimDeduplicationBadge';
import { type ADUCanonicalMapping } from '@/lib/api';

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
  onADUClick,
}: ArgumentHighlightsProps) {
  const [hoveredADU, setHoveredADU] = useState<string | null>(null);

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

  const handleClaimClick = (adu: ADU) => {
    if (onADUClick) {
      // MajorClaim and Evidence navigate to search; Supporting and Opposing open reply composer
      const action = (adu.adu_type === 'MajorClaim' || adu.adu_type === 'Evidence')
        ? 'search' as const
        : 'reply' as const;
      onADUClick(adu, action);
    }
  };

  return (
    <div className="whitespace-pre-wrap text-sm leading-relaxed">
      {segments.map((seg, idx) => {
        if (!seg.adu) {
          return <span key={idx}>{seg.text}</span>;
        }

        const aduType = seg.adu.adu_type;
        const style = typeStyles[aduType];
        const hoveredAdu = hoveredADU ? aduById.get(hoveredADU) : undefined;
        const isHovered = hoveredADU === seg.adu.id
          || (hoveredAdu?.target_adu_id === seg.adu.id);
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
                ${onADUClick ? 'cursor-pointer' : ''}
                ${isHovered ? style.hover : `${style.base} hover:bg-opacity-50`}
              `}
              data-testid={`highlight-${aduType.toLowerCase()}`}
              onClick={() => handleClaimClick(seg.adu!)}
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
                isExpanded={false}
              />
            )}
          </span>
        );
      })}
    </div>
  );
}
