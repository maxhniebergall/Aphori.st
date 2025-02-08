/**
 * Requirements:
 * - Memory efficient row rendering with React.memo
 * - Hide descendant nodes when in reply mode using row indices
 * - Render loading, fallback, title, or normal node states as appropriate
 * - Delegate dynamic height and ref handling to RowContainer
 */

import React, { useCallback, useMemo } from 'react';
import { ListChildComponentProps } from 'react-window';
import RowContainer from './RowContainer';
import RowLoading from './RowLoading';
import RowFallback from './RowFallback';
import TitleRow from './TitleRow';
import NormalRowContent from './NormalRowContent';
import { StoryTreeNode as StoryTreeNodeType } from '../context/types';

interface RowProps extends Omit<ListChildComponentProps, 'data'> {
  node: StoryTreeNodeType | null;
  setSize: (index: number, size: number) => void;
  handleSiblingChange: (
    newNode: StoryTreeNodeType,
    index: number,
    fetchNode: (id: string) => Promise<void>
  ) => void;
  fetchNode: (id: string) => Promise<void>;
  isLoading: boolean;
  postRootId: string;
  replyTargetIndex?: number;
  parentId: string;
  setIsFocused?: (focused: boolean) => void;
}

const Row: React.FC<RowProps> = React.memo(
  ({ index, style, node, setSize, handleSiblingChange, fetchNode, isLoading, postRootId, replyTargetIndex, parentId, setIsFocused }) => {
    // Determine if the node should be hidden based on reply mode
    const shouldHide = useMemo(() => {
      if (replyTargetIndex === undefined) return false;
      return index > replyTargetIndex;
    }, [replyTargetIndex, index]);

    // Memoize the user's style and merge necessary absolute positioning
    const containerStyle = useMemo(() => ({
      ...style,
    }), [style]);

    // Choose which content component to render
    let content;
    if (shouldHide) {
      // Render an empty container for hidden nodes
      content = null;
    } else if (isLoading) {
      content = <RowLoading />;
    } else if (!node || typeof node !== 'object' || !node.storyTree || typeof node.storyTree !== 'object') {
      console.warn(`Invalid node or storyTree at index ${index}:`, {
        node,
        storyTreeExists: !!node?.storyTree,
        storyTreeType: typeof node?.storyTree,
      });
      content = <RowFallback message="Loading node..." />;
    } else if (node.storyTree.isTitleNode) {
      content = <TitleRow node={node} />;
    } else {
      content = (
        <NormalRowContent
          node={node}
          onSiblingChange={handleSiblingChange}
          index={index}
          fetchNode={fetchNode}
          postRootId={postRootId}
          parentId={parentId}
          setIsFocused={setIsFocused}
        />
      );
    }

    return (
      <RowContainer
        index={index}
        setSize={setSize}
        shouldHide={shouldHide}
        style={containerStyle}
      >
        {content}
      </RowContainer>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.node?.storyTree?.id === nextProps.node?.storyTree?.id &&
      prevProps.isLoading === nextProps.isLoading &&
      prevProps.index === nextProps.index &&
      prevProps.style.top === nextProps.style.top
    );
  }
);

export default Row; 