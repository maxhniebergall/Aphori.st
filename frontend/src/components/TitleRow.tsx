/**
 * Requirements:
 * - Display story title and subtitle
 * - Use semantic HTML elements for header content
 */

import React from 'react';
import { StoryTreeLevel } from '../context/types';

interface TitleRowProps {
  node: StoryTreeLevel;
}

const TitleRow: React.FC<TitleRowProps> = ({ node }) => {
  return (
    <div className="title-row">
      <h1 className="title">
        {node?.storyTree?.metadata?.title || node?.storyTree?.text || 'Untitled'}
      </h1>
      <div className="metadata">
        <span className="author">{node?.storyTree?.metadata?.author || 'Anonymous'}</span>
        <span className="date">
          {node?.storyTree?.metadata?.createdAt
            ? new Date(node.storyTree.metadata.createdAt).toLocaleDateString()
            : 'Unknown date'}
        </span>
      </div>
    </div>
  );
};

export default TitleRow; 