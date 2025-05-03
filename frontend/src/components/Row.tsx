/**
 * Unified Row Component
 * This file contains a single component that handles all row functionality:
 * - Dynamic height management with resize observation
 * - PostTreeLevel rendering with navigation callbacks
 * - Virtualization support for react-window
 */

import React, { memo, useCallback } from 'react';
import PostTreeLevelComponent from './PostTreeLevel';
import { PostTreeLevel } from '../types/types';

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
  }) => {

  // Create content component directly within Row
  const content = useCallback((levelData: PostTreeLevel) => {
    // No need to check shouldHide here, handled above
    return (
      <div className="normal-row-content" style={{ margin: 0 }}>
        <PostTreeLevelComponent
          levelData={levelData}
        />
      </div>
    );
  }, []);

    // Check if hidden first
    if (shouldHide) {
      return <div style={{ height: '1px', overflow: 'hidden' }} aria-hidden="true" />;
    }


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
        {content(levelData)}
      </div>
    );
  }
);

// Add display name for better debugging
Row.displayName = 'Row';

// Memoize the Row component
export const MemoizedRow = React.memo(Row);

export default Row; 