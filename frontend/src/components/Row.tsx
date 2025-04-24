/**
 * Unified Row Component
 * This file contains a single component that handles all row functionality:
 * - Dynamic height management with resize observation
 * - StoryTreeLevel rendering with navigation callbacks
 * - Virtualization support for react-window
 */

import React, { useRef, useMemo, memo, useCallback, useState } from 'react';
import { ListChildComponentProps } from 'react-window';
import useDynamicRowHeight from '../hooks/useDynamicRowHeight';
import StoryTreeLevelComponent from './StoryTreeLevel';
import { StoryTreeLevel, StoryTreeNode } from '../types/types';
import { 
  getSelectedQuote, 
  getSiblings, 
  getSelectedNodeHelper, 
  setSelectedNodeHelper, 
  getRootNodeId,
  isMidLevel
} from '../utils/levelDataHelpers';
import { Quote } from '../types/quote';

// Row Component Props - combines all previous component props
interface RowProps extends Omit<ListChildComponentProps, 'data'> {
  levelData: StoryTreeLevel;
  setSize: (visualHeight: number) => void;
  shouldHide: boolean;
  index: number;
}

/**
 * Unified Row component that handles all row-related functionality
 * - Dynamic height management
 * - Content rendering
 * - Style computation
 */
const Row: React.FC<RowProps> = memo(
  ({
    style, 
    levelData, 
    setSize, 
    shouldHide,
    index
  }) => {
    // Reference to the row element for measuring height
    const rowRef = useRef<HTMLDivElement>(null);

    // Added dummy state to force re-render
    const [reRender, setReRender] = useState(0);

    // Use the dynamic height hook directly in the Row component
    useDynamicRowHeight({
      rowRef,
      setSize,
      shouldHide,
    });

    // Compute the final style for the row
    const computedStyle: React.CSSProperties = useMemo(() => {
      return {
        ...style,
        position: 'absolute',
        left: 0,
        right: 0,
        width: '100%',
        padding: shouldHide ? 0 : '20px',
        boxSizing: 'border-box',
        display: shouldHide ? 'none' : 'block',
        minHeight: shouldHide ? 0 : 100,
        overflow: 'visible',
        opacity: shouldHide ? 0 : 1,
        transition: 'opacity 0.2s ease-in-out'
      };
    }, [style, shouldHide]);

    // Create navigation callbacks for StoryTreeLevel
    const navigateToNextSiblingCallback = useCallback(() => {
      // Skip if not a MidLevel
      if (!isMidLevel(levelData)) {
        
        return;
      }

      
      const selectedQuote = getSelectedQuote(levelData);
      if (!selectedQuote) {
        throw new Error('No selected quote');
      }
      
      const siblings = getSiblings(levelData);
      if (!siblings) {
        throw new Error('No siblings found');
      }
      
      const siblingsForQuote = siblings.levelsMap.find(
        ([quote]) => quote && selectedQuote && quote.toString() === selectedQuote.toString()
      );
      
      if (!siblingsForQuote){
        throw new Error('No siblings for quote');
      }
      
      const selectedNode = getSelectedNodeHelper(levelData);
      if (!selectedNode) {
        throw new Error('No selected node');
      }
      
      const currentIndex = siblingsForQuote[1].findIndex(sibling => { 
        return sibling.id === selectedNode.id;
      });
  
      if (currentIndex + 1 > siblingsForQuote[1].length - 1) {
        throw new Error('No next sibling');
      }
      
      const nextSibling = siblingsForQuote[1][currentIndex + 1];
      if (!nextSibling) {
        throw new Error('No next sibling');
      }
      
      // Update the levelData with the new selected node
      const updatedLevelData = setSelectedNodeHelper(levelData, nextSibling);
      // Since we're mutating a prop, we need to update the original object
      if (levelData.midLevel) {
        levelData.midLevel.selectedNode = nextSibling;
      }
      
      // Force re-render by updating dummy state
      setReRender(prev => prev + 1);
    }, [levelData]);

    const navigateToPreviousSiblingCallback = useCallback(() => {
      // Skip if not a MidLevel
      if (!isMidLevel(levelData)) {
        
        return;
      }

      
      const selectedQuote = getSelectedQuote(levelData);
      if (!selectedQuote) {
        throw new Error('No selected quote');
      }
      
      const siblings = getSiblings(levelData);
      if (!siblings) {
        throw new Error('No siblings found');
      }
      
      const siblingsForQuote = siblings.levelsMap.find(
        ([quote]) => quote && selectedQuote && quote.toString() === selectedQuote.toString()
      );
      
      if (!siblingsForQuote){
        throw new Error('No siblings for quote');
      }
      
      const selectedNode = getSelectedNodeHelper(levelData);
      if (!selectedNode) {
        throw new Error('No selected node');
      }
      
      const currentIndex = siblingsForQuote[1].findIndex(sibling => { 
        return sibling.id === selectedNode.id;
      });
  
      if (currentIndex - 1 < 0) {
        throw new Error('No previous sibling');
      }
      
      const previousSibling = siblingsForQuote[1][currentIndex - 1];
      if (!previousSibling) {
        throw new Error('No previous sibling');
      }
      
      // Update the levelData with the new selected node
      const updatedLevelData = setSelectedNodeHelper(levelData, previousSibling);
      // TODO this isn't right, we need to use the updatedLevelData object
      // Since we're mutating a prop, we need to update the original object
      if (levelData.midLevel) {
        levelData.midLevel.selectedNode = previousSibling;
      }
      
      // Force re-render by updating dummy state
      setReRender(prev => prev + 1);
    }, [levelData]);

    // Create content component directly within Row
    const content = useMemo(() => {
      if (shouldHide) {
        return null;
      }
      // Log the props passed to StoryTreeLevelComponent
      
      return (
        <div className="normal-row-content">
          <StoryTreeLevelComponent
            levelData={levelData}
            navigateToNextSiblingCallback={navigateToNextSiblingCallback}
            navigateToPreviousSiblingCallback={navigateToPreviousSiblingCallback}
          />
        </div>
      );
    }, [levelData, shouldHide, navigateToNextSiblingCallback, navigateToPreviousSiblingCallback]);

    // Log the props received by Row for debugging propagation
    

    return (
      <div
        ref={rowRef}
        style={computedStyle}
        className="row-container"
        role="listitem"
        aria-label="Story content"
      >
        {content}
      </div>
    );
  },
  (prevProps, nextProps) => {
    // Check if the selected node's quote counts have changed
    const prevSelectedNode = getSelectedNodeHelper(prevProps.levelData);
    const nextSelectedNode = getSelectedNodeHelper(nextProps.levelData);
    
    const prevQuoteCounts = prevSelectedNode?.quoteCounts;
    const nextQuoteCounts = nextSelectedNode?.quoteCounts;
    
    // If quote counts changed, we should re-render
    if (prevQuoteCounts !== nextQuoteCounts) {
      return false; // Return false to trigger re-render
    }
    
    // Otherwise, use existing checks to determine if we should update
    return (
      getRootNodeId(prevProps.levelData) === getRootNodeId(nextProps.levelData) &&
      prevProps.index === nextProps.index &&
      prevProps.style.top === nextProps.style.top &&
      prevProps.shouldHide === nextProps.shouldHide
    );
  }
);

// Add display name for better debugging
Row.displayName = 'Row';

export default Row; 