'use client';

import { useState } from 'react';

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
}

interface ArgumentHighlightsProps {
  text: string;
  adus: ADU[];
  onADUClick?: (adu: ADU) => void;
}

function segmentText(text: string, adus: ADU[]): Segment[] {
  // Sort ADUs by span_start, split text into segments
  const sorted = [...adus].sort((a, b) => a.span_start - b.span_start);
  const segments: Segment[] = [];
  let pos = 0;

  for (const adu of sorted) {
    if (pos < adu.span_start) {
      segments.push({ text: text.slice(pos, adu.span_start) });
    }
    segments.push({ text: text.slice(adu.span_start, adu.span_end), adu });
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
  onADUClick,
}: ArgumentHighlightsProps) {
  const [hoveredADU, setHoveredADU] = useState<string | null>(null);
  const segments = segmentText(text, adus);

  return (
    <div className="whitespace-pre-wrap text-base leading-relaxed">
      {segments.map((seg, idx) => {
        if (!seg.adu) {
          return (
            <span key={idx}>{seg.text}</span>
          );
        }

        const isClaim = seg.adu.adu_type === 'claim';
        const isHovered = hoveredADU === seg.adu.id;

        return (
          <span
            key={idx}
            className={`
              cursor-pointer border-b-2 transition-colors
              ${isClaim
                ? isHovered
                  ? 'border-blue-600 bg-blue-100 dark:border-blue-400 dark:bg-blue-900/30'
                  : 'border-blue-500 hover:bg-blue-50 dark:border-blue-400 dark:hover:bg-blue-900/20'
                : isHovered
                  ? 'border-green-600 bg-green-100 dark:border-green-400 dark:bg-green-900/30'
                  : 'border-green-500 hover:bg-green-50 dark:border-green-400 dark:hover:bg-green-900/20'
              }
            `}
            onClick={() => onADUClick?.(seg.adu!)}
            onMouseEnter={() => setHoveredADU(seg.adu!.id)}
            onMouseLeave={() => setHoveredADU(null)}
            title={`${isClaim ? 'Claim' : 'Premise'} (${(seg.adu.confidence * 100).toFixed(0)}%)`}
          >
            {seg.text}
          </span>
        );
      })}
    </div>
  );
}
