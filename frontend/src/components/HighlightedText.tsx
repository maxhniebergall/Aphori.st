/*
 * Requirements:
 * - Render text with overlapping highlights
 * - Support varying highlight intensity based on overlap count
 * - Handle click events on highlighted segments
 * - Integrate with the Quote system
 */

import React, { useMemo, useState } from 'react';
import { Quote, areQuotesEqual } from '../types/quote';
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
  const [activeQuoteObj, setActiveQuoteObj] = useState<Quote | null>(null);
  const [globalCycleQuote, setGlobalCycleQuote] = useState<Quote | null>(null); 

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

  const handleSegmentClick = (segment: TextSegment) => {
    if (!onSegmentClick || segment.overlapCount === 0 || !selections || selections.length === 0) {
      return;
    }

    const overlappingQuotes = segment.overlappingQuotes;
    if (overlappingQuotes.length === 0) {
      return;
    }

    const currentGlobalQuoteIndex = globalCycleQuote 
      ? selections.findIndex(q => areQuotesEqual(q, globalCycleQuote)) 
      : -1;

    let nextGlobalQuote: Quote | null = null;
    let searchStartIndex = (currentGlobalQuoteIndex + 1) % selections.length;

    for (let i = 0; i < selections.length; i++) {
      const currentIndex = (searchStartIndex + i) % selections.length;
      const candidateQuote = selections[currentIndex];
      
      if (overlappingQuotes.some(oq => areQuotesEqual(oq, candidateQuote))) {
        nextGlobalQuote = candidateQuote;
        break;
      }
    }

    if (!nextGlobalQuote && overlappingQuotes.length > 0) {
        nextGlobalQuote = overlappingQuotes[0];
    }
    
    if (nextGlobalQuote && onSegmentClick) {
      onSegmentClick(nextGlobalQuote);
    }

    setGlobalCycleQuote(nextGlobalQuote);
    
    let previewQuote: Quote | null = null;
    if (nextGlobalQuote) {
      const nextGlobalQuoteIndex = selections.findIndex(q => areQuotesEqual(q, nextGlobalQuote!));
      let previewSearchStartIndex = (nextGlobalQuoteIndex + 1) % selections.length;

      for (let i = 0; i < selections.length; i++) {
        const previewCurrentIndex = (previewSearchStartIndex + i) % selections.length;
        const previewCandidateQuote = selections[previewCurrentIndex];
        
        if (overlappingQuotes.some(oq => areQuotesEqual(oq, previewCandidateQuote))) {
          previewQuote = previewCandidateQuote;
          break;
        }
      }

      if (!previewQuote && overlappingQuotes.length > 0) {
          previewQuote = overlappingQuotes[0];
      }
    }
    
    setActiveQuoteObj(previewQuote); 
  };

  const handleMouseEnter = (segment: TextSegment) => {
    if (segment.overlapCount === 0 || !selections || selections.length === 0) {
      setActiveQuoteObj(null);
      return;
    }

    const overlappingQuotes = segment.overlappingQuotes;
    if (overlappingQuotes.length === 0) {
      setActiveQuoteObj(null);
      return; 
    }

    const currentGlobalQuoteIndex = globalCycleQuote 
      ? selections.findIndex(q => areQuotesEqual(q, globalCycleQuote)) 
      : -1;

    let potentialNextGlobalQuote: Quote | null = null;
    let searchStartIndex = (currentGlobalQuoteIndex + 1) % selections.length;

    for (let i = 0; i < selections.length; i++) {
      const currentIndex = (searchStartIndex + i) % selections.length;
      const candidateQuote = selections[currentIndex];

      if (overlappingQuotes.some(oq => areQuotesEqual(oq, candidateQuote))) {
        potentialNextGlobalQuote = candidateQuote;
        break; 
      }
    }

    if (!potentialNextGlobalQuote && overlappingQuotes.length > 0) {
        potentialNextGlobalQuote = overlappingQuotes[0]; 
    }
    
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

        const isActiveSegment = activeQuoteObj !== null &&
                                 activeQuoteObj.selectionRange &&
                                 segment.start >= activeQuoteObj.selectionRange.start &&
                                 segment.end <= activeQuoteObj.selectionRange.end;

        const isBlueUnderlineSegment = selectedQuoteOfThisNode !== undefined && selectedQuoteOfThisNode !== null &&
                                          selectedQuoteOfThisNode.selectionRange &&
                                          segment.start >= selectedQuoteOfThisNode.selectionRange.start &&
                                          segment.end <= selectedQuoteOfThisNode.selectionRange.end;

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