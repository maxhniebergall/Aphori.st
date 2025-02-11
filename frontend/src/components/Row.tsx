/**
 * Requirements:
 * - Memory efficient row rendering with React.memo
 * - Hide descendant nodes when in reply mode using row indices
 * - Render loading, fallback, title, or normal node states as appropriate
 * - Delegate dynamic height and ref handling to RowContainer
 * - TypeScript support with strict typing
 * - Yarn for package management
 * - Proper error handling
 * - Loading state management
 * - Accessibility compliance
 * - Performance optimization
 * - Proper null checks and fallbacks
 * - Consistent component rendering
 */

import React, { useMemo } from 'react';
import { ListChildComponentProps } from 'react-window';
import RowContainer from './RowContainer';
import RowLoading from './RowLoading';
import RowFallback from './RowFallback';
import TitleRow from './TitleRow';
import NormalRowContent from './NormalRowContent';
import { StoryTreeLevel, StoryTree } from '../context/types';

interface RowProps extends Omit<ListChildComponentProps, 'data'> {
  node: StoryTreeLevel | null;
  setSize: (index: number, size: number) => void;
  handleSiblingChange: (
    newNode: StoryTreeLevel,
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
  ({ 
    index, 
    style, 
    node, 
    setSize, 
    handleSiblingChange, 
    fetchNode, 
    isLoading, 
    postRootId, 
    replyTargetIndex, 
    parentId, 
    setIsFocused 
  }) => {
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
    const content = useMemo(() => {
      if (shouldHide) {
        return null;
      }

      if (isLoading) {
        return <RowLoading />;
      }

      if (!node || !node.rootNodeId) {
        return <RowFallback message="Loading node..." />;
      }

      if (node.isTitleNode) {
        return <TitleRow node={node} />;
      }

      return (
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
    }, [
      shouldHide,
      isLoading,
      node,
      index,
      handleSiblingChange,
      fetchNode,
      postRootId,
      parentId,
      setIsFocused
    ]);

    // Create wrapper div for accessibility attributes
    const wrappedContent = useMemo(() => (
      <div role="listitem" aria-label={node?.isTitleNode ? 'Story title' : 'Story content'}>
        {content}
      </div>
    ), [content, node?.isTitleNode]);

    return (
      <RowContainer
        index={index}
        setSize={setSize}
        shouldHide={shouldHide}
        style={containerStyle}
      >
        {wrappedContent}
      </RowContainer>
    );
  },
  (prevProps, nextProps) => {
    // Optimize re-renders by checking essential props
    return (
      prevProps.node?.rootNodeId === nextProps.node?.rootNodeId &&
      prevProps.isLoading === nextProps.isLoading &&
      prevProps.index === nextProps.index &&
      prevProps.style.top === nextProps.style.top &&
      prevProps.replyTargetIndex === nextProps.replyTargetIndex
    );
  }
);

// Add display name for better debugging
Row.displayName = 'Row';

export default Row; 