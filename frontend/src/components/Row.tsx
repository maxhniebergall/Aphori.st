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
import { StoryTreeLevel, StoryTree } from '../types/types';

interface RowProps extends Omit<ListChildComponentProps, 'data'> {
  parentId: string;
  levelData: StoryTreeLevel;
  setSize: (visualHeight: number) => void;
  postRootId: string;
  isReplyTarget?: boolean;
}

const Row: React.FC<RowProps> = React.memo(
  ({
    parentId, 
    style, 
    levelData, 
    setSize, 
    postRootId,
    isReplyTarget 
  }) => {
    // Determine if the node should be hidden based on reply mode
    const shouldHide = useMemo(() => {
      if (isReplyTarget === undefined) return false;
      return isReplyTarget;
    }, [isReplyTarget]);

    // Memoize the user's style and merge necessary absolute positioning
    const containerStyle = useMemo(() => ({
      ...style,
    }), [style]);

    // Choose which content component to render
    const content = useMemo(() => {
      if (levelData?.isTitleNode) {
        return <TitleRow node={levelData} />;
      }

      return (
        <NormalRowContent
          parentId={parentId}
          levelData={levelData}
          postRootId={postRootId}
        />
      );
    }, [
      shouldHide,
      isLoading,
      levelData,
      levelNumber,
      handleSiblingChange,
      fetchNode,
      postRootId,
      parentId,
      setIsFocused
    ]);

    // Create wrapper div for accessibility attributes
    const wrappedContent = useMemo(() => (
      <div role="listitem" aria-label={levelData?.isTitleNode ? 'Story title' : 'Story content'}>
        {content}
      </div>
    ), [content, levelData?.isTitleNode]);

    return (
      <RowContainer
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
      prevProps.levelData?.rootNodeId === nextProps.levelData?.rootNodeId &&
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