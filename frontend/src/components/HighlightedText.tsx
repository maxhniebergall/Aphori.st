/*
 * Requirements:
 * - Render text with overlapping highlights
 * - Support varying highlight intensity based on overlap count
 * - Handle click events on highlighted segments
 * - Integrate with the Quote system
 */

import React, { useMemo, useState } from 'react';
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
  const [activeSelectionIndex, setActiveSelectionIndex] = useState<number | null>(null);
  const [clickCycleState, setClickCycleState] = useState<Map<number, number>>(new Map());

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

    // Determine the next index in the cycle for this segment
    const currentCycleIndex = clickCycleState.get(segment.start) ?? -1; // Start before the first index
    const nextCycleIndex = (currentCycleIndex + 1) % segment.overlappingQuoteOriginalIndices.length;
    
    // Update the cycle state for this segment's start position
    setClickCycleState(new Map(clickCycleState).set(segment.start, nextCycleIndex));

    // Get the actual original index of the selection to activate
    const activatedSelectionIndex = segment.overlappingQuoteOriginalIndices[nextCycleIndex];
    
    // Set this selection as active (for hover effect consistency after click)
    setActiveSelectionIndex(activatedSelectionIndex); 

    // Trigger the callback with the selected quote
    if (activatedSelectionIndex >= 0 && activatedSelectionIndex < selections.length) {
      onSegmentClick(selections[activatedSelectionIndex]);
    }
  };

  // Handle mouse enter on a segment
  const handleMouseEnter = (segment: TextSegment) => {
    if (segment.overlapCount > 0 && segment.overlappingQuoteOriginalIndices.length > 0) {
      // For hover, always highlight the first associated selection for simplicity
      // More complex logic could cycle on hover too, but might be jarring.
      const hoverSelectionIndex = segment.overlappingQuoteOriginalIndices[0];
      setActiveSelectionIndex(hoverSelectionIndex);
    }
  };

  // Handle mouse leave from a segment
  const handleMouseLeave = () => {
    setActiveSelectionIndex(null);
  };

  // Get the active quote based on the activeSelectionIndex
  const activeQuote = activeSelectionIndex !== null ? selections[activeSelectionIndex] : null;

  // Render text segments with appropriate highlighting based on overlap count
  return (
    <div className="highlighted-text" data-testid="highlighted-text">
      {segments.map((segment, idx) => {
        // Base background color based on overlap count
        const baseBackgroundColor = segment.overlapCount > 0
          ? `rgba(50, 205, 50, ${Math.min(0.2 + segment.overlapCount * 0.1, 0.7)})`
          : 'transparent';

        // Determine if this segment is part of the currently active selection (hover or click)
        const isActiveSegment = activeQuote !== null && 
                                 activeQuote.selectionRange &&
                                 segment.start >= activeQuote.selectionRange.start && 
                                 segment.end <= activeQuote.selectionRange.end;

        // Use active color if it's part of the active selection, otherwise use base color
        const finalBackgroundColor = isActiveSegment
          ? 'rgba(50, 205, 50, 0.8)' // Active/hover color
          : baseBackgroundColor;

        // Add border and styling for highlighted segments
        const style: React.CSSProperties = {
          backgroundColor: finalBackgroundColor,
          cursor: segment.overlapCount > 0 ? 'pointer' : 'inherit',
          display: 'inline',
          transition: 'background-color 0.2s ease', // Apply transition here
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
            onMouseEnter={() => handleMouseEnter(segment)}
            onMouseLeave={handleMouseLeave}
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