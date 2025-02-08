/**
 * Requirements:
 * - Render quote text and source information from the given quote prop
 * - Provide a link to the original post based on the quote sourcePostId
 * - TypeScript support for props
 */

import React from 'react';

interface QuoteRendererProps {
  quote: {
    text: string;
    sourcePostId: string;
  };
}

const QuoteRenderer: React.FC<QuoteRendererProps> = ({ quote }) => {
  return (
    <div className="story-tree-node-quote">
      {quote.text}
      <div className="story-tree-node-quote-source">
        Quoted from <a href={`/storyTree/${quote.sourcePostId}`}>original post</a>
      </div>
    </div>
  );
};

export default QuoteRenderer; 