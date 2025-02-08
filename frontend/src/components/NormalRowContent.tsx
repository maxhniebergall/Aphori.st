/**
 * Requirements:
 * - Render a StoryTreeLevel to display regular node content
 * - Pass down proper props such as onSiblingChange and fetchNode
 * - Ensure consistency with parent's state for reply handling
 */

import React from 'react';
import { StoryTreeLevel } from '../context/types';
import StoryTreeLevelComponent from './StoryTreeLevel';

interface NormalRowContentProps {
  node: StoryTreeLevel;
  onSiblingChange: (newNode: StoryTreeLevel, index: number, fetchNode: (id: string) => Promise<void>) => void;
  index: number;
  fetchNode: (id: string) => Promise<void>;
  postRootId: string;
  parentId: string;
  setIsFocused?: (focused: boolean) => void;
}

const NormalRowContent: React.FC<NormalRowContentProps> = ({
  node,
  onSiblingChange,
  index,
  fetchNode,
  postRootId,
  parentId,
  setIsFocused,
}) => {
  return (
    <div className="normal-row-content">
      <StoryTreeLevelComponent
        node={node}
        onSiblingChange={(newNode: StoryTreeLevel) =>
          onSiblingChange(newNode, index, fetchNode)
        }
      />
    </div>
  );
};

export default NormalRowContent; 