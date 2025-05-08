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
import MDEditor from '@uiw/react-md-editor';
import '@uiw/react-md-editor/markdown-editor.css';
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
}) => {
  return (
    <div className="highlighted-text-container" data-color-mode="light">
      <MDEditor.Markdown source={text} />
    </div>
  );
};

export default HighlightedText; 