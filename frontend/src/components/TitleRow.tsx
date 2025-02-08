/**
 * Requirements:
 * - Display story title and subtitle
 * - Use semantic HTML elements for header content
 */

import React from 'react';
import { StoryTreeNode as StoryTreeNodeType } from '../context/types';

interface TitleRowProps {
  node: StoryTreeNodeType;
}

const TitleRow: React.FC<TitleRowProps> = ({ node }) => {
  return (
    <div className="title-row">
      <div className="story-title-section">
        {node.storyTree.metadata?.title && <h1>{node.storyTree.metadata.title}</h1>}
        {node.storyTree.metadata?.author && (
          <h2 className="story-subtitle">by {node.storyTree.metadata.author}</h2>
        )}
      </div>
    </div>
  );
};

export default TitleRow; 