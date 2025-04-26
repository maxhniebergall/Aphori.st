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
  selectedQuoteOfThisNode?: Quote | null;
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
  onSegmentClick,
  selectedQuoteOfThisNode
}) => {
  const [activeSelectionIndex, setActiveSelectionIndex] = useState<number | null>(null);
  // Index in the main `selections` array of the last activated quote via click cycle
  const [globalCycleIndex, setGlobalCycleIndex] = useState<number>(-1); 

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
  }, [text, selections, selectedQuoteOfThisNode]);

  // Handle click on a highlighted segment
  const handleSegmentClick = (segment: TextSegment) => {
    if (!onSegmentClick || segment.overlapCount === 0 || !selections || selections.length === 0) {
      return;
    }

    const overlappingIndices = segment.overlappingQuoteOriginalIndices;
    if (overlappingIndices.length === 0) {
      return; // Should not happen if overlapCount > 0, but safeguard
    }

    // Find the next quote index in the global cycle that overlaps this segment
    let nextGlobalIndex = -1;
    let searchStartIndex = (globalCycleIndex + 1) % selections.length;
    for (let i = 0; i < selections.length; i++) {
      const currentIndex = (searchStartIndex + i) % selections.length;
      
      // Check if the quote at currentIndex overlaps with the clicked segment
      const currentQuote = selections[currentIndex];
      if (currentQuote && currentQuote.selectionRange && 
          currentQuote.selectionRange.start <= segment.start && 
          currentQuote.selectionRange.end >= segment.end &&
          overlappingIndices.includes(currentIndex)) { // Ensure it's one of the segment's overlaps
          
          nextGlobalIndex = currentIndex;
          break; // Found the next one
      }
    }

    // Fallback if no suitable next quote is found (e.g., filters changed)
    // In this case, just pick the first overlapping quote for the segment
    if (nextGlobalIndex === -1) {
        nextGlobalIndex = overlappingIndices[0];
    }
    
    // Update the global cycle index
    setGlobalCycleIndex(nextGlobalIndex);

    // Set this selection as active (for hover effect consistency after click)
    // setActiveSelectionIndex(nextGlobalIndex); // Removed this line

    // Trigger the callback with the selected quote
    if (nextGlobalIndex >= 0 && nextGlobalIndex < selections.length) {
      onSegmentClick(selections[nextGlobalIndex]);
    }
  };

  // Handle mouse enter on a segment
  const handleMouseEnter = (segment: TextSegment) => {
    if (segment.overlapCount === 0 || !selections || selections.length === 0) {
      setActiveSelectionIndex(null);
      return;
    }

    const overlappingIndices = segment.overlappingQuoteOriginalIndices;
    if (overlappingIndices.length === 0) {
      setActiveSelectionIndex(null);
      return; 
    }

    // Find the quote index that *would* be selected next in the global cycle if clicked
    let nextQuoteIndexForHover = -1;
    let searchStartIndex = (globalCycleIndex + 1) % selections.length;
    for (let i = 0; i < selections.length; i++) {
      const currentIndex = (searchStartIndex + i) % selections.length;
      
      const currentQuote = selections[currentIndex];
      if (currentQuote && currentQuote.selectionRange && 
          currentQuote.selectionRange.start <= segment.start && 
          currentQuote.selectionRange.end >= segment.end &&
          overlappingIndices.includes(currentIndex)) { 
          
          nextQuoteIndexForHover = currentIndex;
          break; 
      }
    }

    // Fallback if no suitable next quote is found (e.g., after filtering)
    if (nextQuoteIndexForHover === -1 && overlappingIndices.length > 0) {
        nextQuoteIndexForHover = overlappingIndices[0];
    }
    
    // Set this quote as active for hover effect
    setActiveSelectionIndex(nextQuoteIndexForHover);
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

        // Determine if this segment is part of the quote designated for a blue underline
        const isBlueUnderlineSegment = selectedQuoteOfThisNode !== undefined && selectedQuoteOfThisNode !== null &&
                                          selectedQuoteOfThisNode.selectionRange &&
                                          segment.start >= selectedQuoteOfThisNode.selectionRange.start &&
                                          segment.end <= selectedQuoteOfThisNode.selectionRange.end;

        // Use active color for background if it's part of the active selection (hover)
        const finalBackgroundColor = isActiveSegment
          ? 'rgba(173, 216, 230, 0.8)' // Light blue for active/hover color
          : baseBackgroundColor;

        // Determine border color based on the selectedQuoteOfThisNode prop
        const borderColor = isBlueUnderlineSegment ? 'rgba(0, 255, 251, 0.8)' : '#228B22'; // Blue if designated, else green

        // Determine if a border should be shown at all
        const shouldShowBorder = segment.overlapCount > 0 || isBlueUnderlineSegment;

        // Add border and styling for highlighted segments
        const style: React.CSSProperties = {
          backgroundColor: finalBackgroundColor,
          cursor: shouldShowBorder ? 'pointer' : 'inherit', // Make cursor pointer if border is shown
          display: 'inline',
          transition: 'background-color 0.2s ease, border-bottom-color 0.2s ease', // Add transition for border color
          ...(shouldShowBorder ? { // Apply border style if needed
            borderBottom: `2px solid ${borderColor}`, // Use dynamic border color
            padding: '0 2px',
            borderRadius: '2px',
          } : {})
        };

        console.log(`Segment ${JSON.stringify(segment)} isBlueUnderlineSegment: ${isBlueUnderlineSegment} isActiveSegment: ${isActiveSegment}`);

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