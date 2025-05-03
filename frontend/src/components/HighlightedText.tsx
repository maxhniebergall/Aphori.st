/*
 * Requirements:
 * - Render text with overlapping highlights
 * - Support varying highlight intensity based on overlap count
 * - Handle click events on highlighted segments
 * - Integrate with the Quote system
 * - Visual Cues:
 *   - Green Highlight (background/border): Indicates the text segment is quoted by one or more child replies. Based on `selections` prop.
 *   - Blue/Teal Underline: Shows which segments belong to the currently selectedQuote in this level. 
 *   - Light Blue Background (hover): Previews the next selected quote under the user's cursor on non-touch devices. Based on `activeQuoteObj` state.
 */

import React, { useMemo, useState, useEffect } from 'react';
import { Quote, areQuotesEqual } from '../types/quote';
import { QuoteCounts } from '../types/types';
import './HighlightedText.css';

interface TextSegment {
  start: number;
  end: number;
  text: string;
  overlapCount: number;
  overlappingQuotes: Quote[];
}

interface HighlightedTextProps {
  text: string;
  selections: Quote[];
  quoteCounts: QuoteCounts;
  onSegmentClick?: (quote: Quote) => void;
  selectedReplyQuote?: Quote | null;
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
  quoteCounts,
  onSegmentClick,
  selectedReplyQuote,
}) => {
  const [activeQuoteObj, setActiveQuoteObj] = useState<Quote | null>(null);
  const [selectedHistory, setSelectedHistory] = useState<Set<string>>(new Set());

  // Reset history if the base selections change
  useEffect(() => {
    setSelectedHistory(new Set());
    // Optionally reset globalCycleQuote too if desired
    // setGlobalCycleQuote(null); 
  }, [selections]);

  // Detect if the primary input mechanism doesn't support hover (likely touch)
  const isTouchDevice = useMemo(() => {
    // Check window exists for environments like SSR
    return typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches;
  }, []);

  const segments = useMemo(() => {
    if (!text || !selections.length) {
      return [{ start: 0, end: text.length, text, overlapCount: 0, overlappingQuotes: [] }];
    }

    let boundaries: number[] = [0, text.length];
    selections.forEach(quote => {
      if (quote && quote.selectionRange) {
        boundaries.push(quote.selectionRange.start, quote.selectionRange.end);
      }
    });
    
    boundaries = Array.from(new Set(boundaries)).sort((a, b) => a - b);

    return boundaries.slice(0, -1).map((start, index) => {
      const end = boundaries[index + 1];
      const segmentText = text.slice(start, end);
      
      const overlappingQuotes: Quote[] = [];
      selections.forEach((quote) => {
        if (quote && quote.selectionRange && 
            quote.selectionRange.start <= start && 
            quote.selectionRange.end >= end) {
          overlappingQuotes.push(quote);
        }
      });
      
      return {
        start,
        end,
        text: segmentText,
        overlapCount: overlappingQuotes.length,
        overlappingQuotes
      };
    });
  }, [text, selections]);

  // Helper to get count for a quote
  const getCount = (quote: Quote, counts: QuoteCounts): number => {
    const countEntry = counts.quoteCounts.find(entry => areQuotesEqual(entry[0], quote));
    return countEntry ? countEntry[1] : 0;
  };

  // Helper function to sort quotes by count
  const sortQuotesByCount = (
    quotesToSort: Quote[], 
    counts: QuoteCounts
  ): Quote[] => {
    return [...quotesToSort].sort((a, b) => getCount(b, counts) - getCount(a, counts));
  };

  // Helper to get the next quote for preview
  const determinePreviewQuote = (currentOverlappingQuotes: Quote[], quoteToExclude: Quote | null, history: Set<string>, counts: QuoteCounts): Quote | null => {
    if (currentOverlappingQuotes.length === 0) return null;

    const sortedOverlapping = sortQuotesByCount(currentOverlappingQuotes, counts);
    
    let potentialPreviewCandidates = sortedOverlapping.filter(q => !quoteToExclude || !areQuotesEqual(q, quoteToExclude));
    
    // FIX: If filtering leaves no candidates, there's nothing valid to preview.
    if (potentialPreviewCandidates.length === 0) {
      return null;
    }

    // Prioritize unseen quotes for preview
    const unseenPreview = potentialPreviewCandidates.find(q => !history.has(Quote.toEncodedString(q)));
    if (unseenPreview) return unseenPreview;

    // If all potential previews have been seen, return the highest priority one (that's not excluded)
    return potentialPreviewCandidates[0];
};

  const handleSegmentClick = (segment: TextSegment) => {
    // Existing logic
    if (!onSegmentClick || segment.overlapCount === 0) {
      return;
    }

    const overlappingQuotes = segment.overlappingQuotes;
    if (overlappingQuotes.length === 0) {
      return;
    }

    const unseenCandidates = overlappingQuotes.filter(q => !selectedHistory.has(Quote.toEncodedString(q)));

    let candidatesToConsider: Quote[];
    let resetCycle = false;

    if (unseenCandidates.length > 0) {
      candidatesToConsider = unseenCandidates;
    } else {
      candidatesToConsider = overlappingQuotes;
      resetCycle = true;
    }

    const sortedCandidates = sortQuotesByCount(candidatesToConsider, quoteCounts);

    if (sortedCandidates.length === 0) {
      return; 
    }

    const nextGlobalQuote = sortedCandidates[0];
    const nextGlobalQuoteId = Quote.toEncodedString(nextGlobalQuote);

    // --- Update State --- 
    onSegmentClick(nextGlobalQuote);

    let nextHistory: Set<string>;
    if (resetCycle) {
      nextHistory = new Set([nextGlobalQuoteId]);
    } else {
      nextHistory = new Set(selectedHistory).add(nextGlobalQuoteId);
    }
    setSelectedHistory(nextHistory);

    // --- Determine Preview ---  
    const previewQuote = determinePreviewQuote(overlappingQuotes, nextGlobalQuote, nextHistory, quoteCounts);
    setActiveQuoteObj(previewQuote);
  };

  const handleMouseEnter = (segment: TextSegment) => {
    if (isTouchDevice || segment.overlapCount === 0) {
      setActiveQuoteObj(null);
      return;
    }
    const overlappingQuotes = segment.overlappingQuotes;
    if (overlappingQuotes.length === 0) {
      setActiveQuoteObj(null);
      return;
    }

    const unseenCandidates = overlappingQuotes.filter(q => !selectedHistory.has(Quote.toEncodedString(q)));
    const candidatesToConsider = unseenCandidates.length > 0 ? unseenCandidates : overlappingQuotes;
    const sortedCandidates = sortQuotesByCount(candidatesToConsider, quoteCounts);
    const potentialNextGlobalQuote = sortedCandidates.length > 0 ? sortedCandidates[0] : null;
    
    setActiveQuoteObj(potentialNextGlobalQuote);
  };

  const handleMouseLeave = () => {
    setActiveQuoteObj(null);
  };

  return (
    <div className="highlighted-text" data-testid="highlighted-text">
      {segments.map((segment, idx) => {
        const baseBackgroundColor = segment.overlapCount > 0
          ? `rgba(50, 205, 50, ${Math.min(0.2 + segment.overlapCount * 0.1, 0.7)})`
          : 'transparent';

        const isActiveSegment = !isTouchDevice && // Only show active state on non-touch devices
                                 activeQuoteObj !== null &&
                                 activeQuoteObj.selectionRange &&
                                 segment.start >= activeQuoteObj.selectionRange.start &&
                                 segment.end <= activeQuoteObj.selectionRange.end;

        const isBlueUnderlineSegment = selectedReplyQuote &&
                                       selectedReplyQuote.selectionRange &&
                                       segment.start >= selectedReplyQuote.selectionRange.start &&
                                       segment.end <= selectedReplyQuote.selectionRange.end;

        const finalBackgroundColor = isActiveSegment
          ? 'rgba(173, 216, 230, 0.8)'
          : baseBackgroundColor;

        const borderColor = isBlueUnderlineSegment ? 'rgba(0, 255, 251, 0.8)' : '#228B22';

        const shouldShowBorder = segment.overlapCount > 0 || isBlueUnderlineSegment;

        const style: React.CSSProperties = {
          backgroundColor: finalBackgroundColor,
          cursor: shouldShowBorder ? 'pointer' : 'inherit',
          display: 'inline',
          transition: 'background-color 0.2s ease, border-bottom-color 0.2s ease',
          ...(shouldShowBorder ? {
            borderBottom: `2px solid ${borderColor}`,
            padding: '0 2px',
            borderRadius: '2px',
          } : {})
        };

        return (
          <span 
            key={idx} 
            style={style}
            onClick={() => handleSegmentClick(segment)}
            // Only attach mouse hover events on non-touch devices
            onMouseEnter={!isTouchDevice ? () => handleMouseEnter(segment) : undefined}
            onMouseLeave={!isTouchDevice ? handleMouseLeave : undefined}
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