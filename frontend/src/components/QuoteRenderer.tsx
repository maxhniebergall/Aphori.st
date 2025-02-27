/**
 * Requirements:
 * - Render quote text and source information
 * - Support TypeScript props
 * - Handle null checks
 * - Support accessibility
 * - Use text for quote text
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
  if (!quote?.text) {
    return null;
  }
  return (
    <div className="quote-container">
      <blockquote className="quote-text">{quote.text}</blockquote>
      {quote.sourcePostId && (
        <Link to={`/post/${quote.sourcePostId}`} className="quote-source">
          View source post
        </Link>
      )}
    </div>
  );
};

export default React.memo(QuoteRenderer); 