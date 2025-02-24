/**
 * Requirements:
 * - Render quote text and source information
 * - Support TypeScript props
 * - Handle null checks
 * - Support accessibility
 * - Use text for quote text
 * - Link to source post
 * - Proper styling
 * - Error handling
 * - Performance optimization
 * - Yarn for package management
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { Quote } from '../types/quote';

interface QuoteRendererProps {
  quote: Quote;
}

const QuoteRenderer: React.FC<QuoteRendererProps> = ({ quote }) => {
  return (
    <div className="quote-container" role="blockquote">
      <blockquote className="quote-text">{quote.text}</blockquote>
    </div>
  );
};

export default React.memo(QuoteRenderer); 