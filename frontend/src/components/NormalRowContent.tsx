/**
 * Requirements:
 * - Render a StoryTreeNode to display regular node content
 * - Pass down proper props such as onSiblingChange and fetchNode
 * - Ensure consistency with parent's state for reply handling
 */

import React from 'react';
import StoryTreeNode from './StoryTreeNode';
import { StoryTreeNode as StoryTreeNodeType } from '../context/types';

interface NormalRowContentProps {
  node: StoryTreeNodeType;
  onSiblingChange: (newNode: StoryTreeNodeType, index: number, fetchNode: (id: string) => Promise<void>) => void;
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
    <StoryTreeNode
      key={node.storyTree.id}
      node={node}
      onSiblingChange={(newNode: StoryTreeNodeType) =>
        onSiblingChange(newNode, index, fetchNode)
      }
      parentId={parentId}
    />
  );
};

export default NormalRowContent; 