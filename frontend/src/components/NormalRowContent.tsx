/**
 * Requirements:
 * - Render a StoryTreeLevel to display regular node content
 */

import React, { memo } from 'react';
import { StoryTreeLevel } from '../types/types';
import StoryTreeLevelComponent from './StoryTreeLevel';

interface NormalRowContentProps {
  levelData: StoryTreeLevel;
}

// Create a memoized component that only re-renders if levelData changes
const NormalRowContent: React.FC<NormalRowContentProps> = memo(({
  levelData,
}) => {
  return (
    <div className="normal-row-content">
      <StoryTreeLevelComponent
        levelData={levelData}
      />
    </div>
  );
}, (prevProps, nextProps) => {
  // Check if the selected node's quote counts have changed
  const prevQuoteCounts = prevProps.levelData?.selectedNode?.quoteCounts;
  const nextQuoteCounts = nextProps.levelData?.selectedNode?.quoteCounts;
  
  // If quote counts changed, we should re-render
  if (prevQuoteCounts !== nextQuoteCounts) {
    return false; // Return false to trigger re-render
  }
  
  // Only re-render if the levelData's key properties have changed
  return (
    prevProps.levelData.rootNodeId === nextProps.levelData.rootNodeId &&
    prevProps.levelData.levelNumber === nextProps.levelData.levelNumber &&
    prevProps.levelData.selectedQuote === nextProps.levelData.selectedQuote
  );
});

// Add display name for better debugging
NormalRowContent.displayName = 'NormalRowContent';

export default NormalRowContent; 