/**
 * Requirements:
 * - Render quote text and source information
 * - Support TypeScript props
 * - Handle null checks
 * - Support accessibility
 * - Use quoteLiteral for quote text
 * - Link to source post
 * - Proper styling
 * - Error handling
 * - Performance optimization
 * - Yarn for package management
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { Quote } from '../types/types';

interface QuoteRendererProps {
  quote: Quote;
}

const QuoteRenderer: React.FC<QuoteRendererProps> = ({ quote }) => {
  return (
    <div className="quote-container" role="blockquote">
      <p className="quote-text">{quote.quoteLiteral}</p>
      <Link to={`/post/${quote.sourcePostId}`} className="quote-source">
        View source post
      </Link>
    </div>
  );
};

export default React.memo(QuoteRenderer); 