/**
 * Unified Row Component
 * This file contains a single component that handles all row functionality:
 * - Dynamic height management with resize observation
 * - PostTreeLevel rendering with navigation callbacks
 * - Virtualization support for react-window
 */

import React, { useRef, useMemo, memo, useCallback, useEffect } from 'react';
import PostTreeLevelComponent from './PostTreeLevel';
import { PostTreeLevel, PostTreeNode, ACTIONS } from '../types/types';
import { Quote, areQuotesEqual } from '../types/quote';
import { 
  getSelectedQuoteInParent,
  getSiblings, 
  getSelectedNodeHelper, 
  isMidLevel,
  getLevelNumber,
} from '../utils/levelDataHelpers';
import postTreeOperator from '../operators/PostTreeOperator';
import { usePostTree } from '../context/PostTreeContext';
import { useReplyContext } from '../context/ReplyContext';

// Row Component Props - update to remove react-window and sizing props
interface RowProps {
  levelData: PostTreeLevel;
  shouldHide: boolean;
  index: number;
}

/**
 * Unified Row component that handles all row-related functionality
 * - Content rendering (height managed by content + Virtuoso)
 * - Style computation simplified
 */
const Row: React.FC<RowProps> = memo(
  ({
    levelData, 
    shouldHide,
    index
  }) => {
    // Check if hidden first
    if (shouldHide) {
      return <div style={{ height: '1px', overflow: 'hidden' }} aria-hidden="true" />;
    }

    const { dispatch } = usePostTree();
    const { isReplyActive } = useReplyContext();
    const levelNumber = useMemo(() => getLevelNumber(levelData), [levelData]);

    // Create content component directly within Row
    const content = useMemo(() => {
      // No need to check shouldHide here, handled above
      return (
        <div className="normal-row-content" style={{ margin: 0 }}>
          <PostTreeLevelComponent
            levelData={levelData}
          />
        </div>
      );
    }, [levelData]);

    // Render the container div for a visible row
    return (
      <div
        style={{
            padding: '20px', // Apply padding only when visible
            boxSizing: 'border-box',
        }}
        className="row-container"
        role="listitem"
        aria-label="Post content row"
        // aria-hidden is removed as we return placeholder when hidden
      >
        {content}
      </div>
    );
  }
);

// Add display name for better debugging
Row.displayName = 'Row';

// Memoize the Row component
export const MemoizedRow = React.memo(Row);

export default Row; 