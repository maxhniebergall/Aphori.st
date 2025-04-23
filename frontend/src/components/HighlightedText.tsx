/*
 * Requirements:
 * - Render text with overlapping highlights
 * - Support varying highlight intensity based on overlap count
 * - Handle click events on highlighted segments
 * - Integrate with the Quote system
 */

import React, { useMemo } from 'react';
import { Quote } from '../types/quote';
import './HighlightedText.css';

interface TextSegment {
  start: number;
  end: number;
  text: string;
  overlapCount: number;
  overlappingQuoteOriginalIndices: number[];
}

interface HighlightedTextProps {
  text: string;
  selections: Quote[];
  onSegmentClick?: (quote: Quote) => void;
}

/**
 * Renders text with overlapping highlights based on selection ranges.
 * The intensity of the highlight increases with the number of overlapping selections.
 * 
 * This component is used in NodeContent for the main content display,
 * while TextSelection is used for the quote container.
 */
export const HighlightedText: React.FC<HighlightedTextProps> = ({ 
  text, 
  selections, 
  onSegmentClick 
}) => {
  // Compute text segments with overlap information
  const segments = useMemo(() => {
    if (!text || !selections.length) {
      return [{ start: 0, end: text.length, text, overlapCount: 0, overlappingQuoteOriginalIndices: [] }];
    }

    // Extract all boundary points from selections
    let boundaries: number[] = [0, text.length];
    selections.forEach(quote => {
      if (quote && quote.selectionRange) {
        boundaries.push(quote.selectionRange.start, quote.selectionRange.end);
      }
    });
    
    // Sort and deduplicate boundaries
    boundaries = Array.from(new Set(boundaries)).sort((a, b) => a - b);

    // Create segments between each pair of adjacent boundaries
    return boundaries.slice(0, -1).map((start, index) => {
      const end = boundaries[index + 1];
      const segmentText = text.slice(start, end);
      
      // Find the original indices of selections that overlap with this segment
      const overlappingQuoteOriginalIndices: number[] = [];
      selections.forEach((quote, originalIndex) => {
        if (quote && quote.selectionRange && 
            quote.selectionRange.start <= start && 
            quote.selectionRange.end >= end) {
          overlappingQuoteOriginalIndices.push(originalIndex);
        }
      });
      
      return {
        start,
        end,
        text: segmentText,
        overlapCount: overlappingQuoteOriginalIndices.length,
        overlappingQuoteOriginalIndices
      };
    });
  }, [text, selections]);

  // Handle click on a highlighted segment
  const handleSegmentClick = (segment: TextSegment) => {
    if (!onSegmentClick || segment.overlapCount === 0 || segment.overlappingQuoteOriginalIndices.length === 0) {
      return;
    }
    
    // If multiple quotes overlap this segment, use the first one's original index
    const originalQuoteIndex = segment.overlappingQuoteOriginalIndices[0];
    if (originalQuoteIndex >= 0 && originalQuoteIndex < selections.length) {
      onSegmentClick(selections[originalQuoteIndex]);
    }
  };

  // Render text segments with appropriate highlighting based on overlap count
  return (
    <div className="highlighted-text" data-testid="highlighted-text">
      {segments.map((segment, idx) => {
        // Calculate background color based on overlap count
        // More overlaps = more intense color
        const backgroundColor = segment.overlapCount > 0
          ? `rgba(50, 205, 50, ${Math.min(0.2 + segment.overlapCount * 0.1, 0.7)})`
          : 'transparent';
        
        // Add border and styling for highlighted segments
        const style: React.CSSProperties = {
          backgroundColor,
          cursor: segment.overlapCount > 0 ? 'pointer' : 'inherit',
          display: 'inline',
          ...(segment.overlapCount > 0 ? {
            borderBottom: '2px solid #228B22',
            padding: '0 2px',
            borderRadius: '2px',
          } : {})
        };

        return (
          <span 
            key={idx} 
            style={style}
            onClick={() => handleSegmentClick(segment)}
            data-overlap-count={segment.overlapCount}
            className={segment.overlapCount > 0 ? 'highlighted-segment' : ''}
          >
            {segment.text}
          </span>
        );
      })}
    </div>
  );
};

export default HighlightedText; 