/**
 * Requirements:
 * - Display story title and subtitle
 * - Use semantic HTML elements for header content
 * - TypeScript support with strict typing
 * - Yarn for package management
 * - Proper error handling for missing metadata
 * - Accessibility compliance
 * - Responsive design support
 * - Proper date formatting
 * - Support for internationalization
 * - Proper null checks and fallbacks
 */

import React from 'react';
import { StoryTreeLevel, StoryTree } from '../types/types';

interface TitleRowProps {
  node: StoryTreeLevel;
  storyTree?: StoryTree;
}

const TitleRow: React.FC<TitleRowProps> = ({ node, storyTree }) => {
  // Format date with proper error handling
  const formatDate = (dateStr?: string): string => {
    if (!dateStr) return 'Unknown date';
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) {
        throw new Error('Invalid date string');
      }
      return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    } catch (error) {
      console.error('Error formatting date:', error);
      return 'Unknown date';
    }
  };

  // Extract metadata with proper null checks
  const title = storyTree?.metadata?.title || node.textContent || 'Untitled';
  const author = storyTree?.metadata?.author || 'Anonymous';
  const date = formatDate(storyTree?.metadata?.createdAt);

  return (
    <header className="title-row" role="banner">
      <h1 className="title" id="story-title">
        {title}
      </h1>
      <div className="metadata" aria-label="Story metadata">
        <div className="author-info">
          <span className="author" aria-label="Author">
            {author}
          </span>
          <time 
            className="date" 
            dateTime={storyTree?.metadata?.createdAt} 
            aria-label="Publication date"
          >
            {date}
          </time>
        </div>
      </div>
    </header>
  );
};

export default TitleRow; 