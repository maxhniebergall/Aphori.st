/**
 * Requirements:
 * - Memory efficient row rendering with React.memo
 * - Hide descendant nodes when in reply mode using row indices
 * - Render loading, fallback, or normal node states as appropriate
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
import NormalRowContent from './NormalRowContent';
import { StoryTreeLevel } from '../types/types';

interface RowProps extends Omit<ListChildComponentProps, 'data'> {
  levelData: StoryTreeLevel;
  setSize: (visualHeight: number) => void;
  shouldHide: boolean;
}

const Row: React.FC<RowProps> = React.memo(
  ({
    style, 
    levelData, 
    setSize, 
    shouldHide
  }) => {
    // Determine if the node should be hidden based on reply mode

    // Memoize the user's style and merge necessary absolute positioning
    const containerStyle = useMemo(() => {
      const mergedStyle = {
        ...style,
      };
      return mergedStyle;
    }, [style]);

    // Create content component
    const content = useMemo(() => {
      return (
        <NormalRowContent
          levelData={levelData}
        />
      );
    }, [
      shouldHide,
      levelData,
    ]);

    // Create wrapper div for accessibility attributes
    const wrappedContent = useMemo(() => {
      return (
        <div role="listitem" aria-label="Story content">
          {content}
        </div>
      );
    }, [content]);

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
    // Check if the selected node's quote counts have changed
    const prevQuoteCounts = prevProps.levelData?.selectedNode?.quoteCounts;
    const nextQuoteCounts = nextProps.levelData?.selectedNode?.quoteCounts;
    
    // If quote counts changed, we should re-render
    if (prevQuoteCounts !== nextQuoteCounts) {
      return false; // Return false to trigger re-render
    }
    
    // Otherwise, use the existing checks
    const shouldUpdate = (
      prevProps.levelData?.rootNodeId === nextProps.levelData?.rootNodeId &&
      prevProps.index === nextProps.index &&
      prevProps.style.top === nextProps.style.top &&
      prevProps.shouldHide === nextProps.shouldHide
    );
    return shouldUpdate;
  }
);

// Add display name for better debugging
Row.displayName = 'Row';

export default Row; 