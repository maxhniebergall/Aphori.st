import React, { createContext, useContext, useReducer, useLayoutEffect, ReactNode } from 'react';
import { StoryTreeState, Action, StoryTreeLevel, StoryTree, StoryTreeNode, Siblings, LastLevel } from '../types/types';
import { ACTIONS } from '../types/types';
import StoryTreeErrorBoundary from './StoryTreeErrorBoundary';
import storyTreeOperator from '../operators/StoryTreeOperator';
import { useUser } from './UserContext';
import { Quote } from '../types/quote';

/*
 * Requirements:
 * - Global state management using React Context
 * - Comprehensive action types for all state changes
 * - Loading state management with simple boolean isLoading
 * - Error handling and propagation
 * - Initial state with proper type definitions
 * - **Cursor based pagination state management**
 * - Sibling navigation state handling
 * - Editing state management
 * - Node removal tracking
 * - Quote metadata and reply counts handling
 * - Support for nested storyTree structure in node objects
 * - Proper type checking for node structure
 * - Handle quote metadata
 * - Support for reply-based navigation
 * - TypeScript type safety and interfaces
 * - Provide state to UI components without exposing dispatch.
 * - Dispatch is centralized in StoryTreeOperator to handle all state updates.
 */

const initialState: StoryTreeState = {
  storyTree: null,
  error: null,
};

function getLevelIndex(existingLevels: Array<StoryTreeLevel | LastLevel>, level: StoryTreeLevel | LastLevel): number {
  return existingLevels.findIndex(existingLevel => 
    existingLevel.rootNodeId === level.rootNodeId && 
    existingLevel.levelNumber === level.levelNumber
  );
}

// Helper function to find siblings for a quote in the array-based structure
function findSiblingsForQuote(siblings: Siblings, quote: Quote | null): StoryTreeNode[] {
  const entry = siblings.levelsMap.find(([key]) => {
    if (key === null && quote === null) {
      return true;
    }
    if (!key || !quote) {
      return false;
    }
    return key.sourcePostId === quote.sourcePostId && 
           key.text === quote.text &&
           key.selectionRange.start === quote.selectionRange.start &&
           key.selectionRange.end === quote.selectionRange.end;
  });
  
  return entry ? entry[1] : [];
}

// Helper function to update siblings for a quote in the array-based structure
function updateSiblingsForQuote(siblings: Siblings, quote: Quote | null, nodes: StoryTreeNode[]): Siblings {
  const index = siblings.levelsMap.findIndex(([key]) => {
    if (key === null && quote === null) {
      return true;
    }
    if (!key || !quote) {
      return false;
    }
    return key.sourcePostId === quote.sourcePostId && 
           key.text === quote.text &&
           key.selectionRange.start === quote.selectionRange.start &&
           key.selectionRange.end === quote.selectionRange.end;
  });
  
  const newLevelsMap = [...siblings.levelsMap];
  
  if (index >= 0) {
    // Replace the existing entry
    newLevelsMap[index] = [quote, nodes];
  } else {
    // Add a new entry
    newLevelsMap.push([quote, nodes]);
  }
  
  return { levelsMap: newLevelsMap };
}

export function mergeLevels(existingLevels: Array<StoryTreeLevel | LastLevel>, newLevels: Array<StoryTreeLevel | LastLevel>): Array<StoryTreeLevel | LastLevel> {
  const returnableLevels = [...existingLevels];

  for (const levelWithNewItems of newLevels) { 
    const levelIndex = getLevelIndex(existingLevels, levelWithNewItems);
    
    if (levelIndex === -1) {
      returnableLevels.push(levelWithNewItems);
    } else if (Object.hasOwn(levelWithNewItems, "pagination") === false) {
      returnableLevels[levelIndex] = levelWithNewItems;
    } else if (Object.hasOwn(returnableLevels[levelIndex], "siblings") === false) {
      throw new Error("attempting to merge a LastLevel with a new level [" + levelWithNewItems.levelNumber + "]"  + JSON.stringify({levelWithNewItems, returnableLevels, levelIndex}));
    } else {
      // Update the pagination information with cursor based details
      const returableLevelAsLevel : StoryTreeLevel = returnableLevels[levelIndex] as StoryTreeLevel;
      const levelWithNewItemsAsLevel : StoryTreeLevel = levelWithNewItems as StoryTreeLevel;
      returableLevelAsLevel.pagination = {
        ...returableLevelAsLevel.pagination,
        ...levelWithNewItemsAsLevel.pagination
      };

      // Merge siblings map using cursor based pagination.
      // Instead of using an index for insertion, check for the existence of prevCursor:
      // if prevCursor exists, the new nodes are from an earlier page and should be prepended;
      // otherwise, they are appended.
      if (levelWithNewItemsAsLevel.siblings?.levelsMap) {
        for (const [quote, newNodesAtLevel] of levelWithNewItemsAsLevel.siblings.levelsMap) {
          const existingSiblings = findSiblingsForQuote(returableLevelAsLevel.siblings, quote);
          
          // Filter out nodes that already exist
          const existingIds = existingSiblings ? new Set(existingSiblings.map((node: StoryTreeNode) => node.id)) : new Set();
          const uniqueNewNodes = newNodesAtLevel.filter((node: StoryTreeNode) => !existingIds.has(node.id));
          
          if (existingSiblings && existingSiblings.length > 0) {
            if (levelWithNewItemsAsLevel.pagination.prevCursor) {
              // Prepend new nodes if pagination indicates loading a previous page.
              returableLevelAsLevel.siblings = updateSiblingsForQuote(
                returableLevelAsLevel.siblings,
                quote,
                [...uniqueNewNodes, ...existingSiblings]
              );
            } else {
              // Otherwise, append new nodes.
              returableLevelAsLevel.siblings = updateSiblingsForQuote(
                returableLevelAsLevel.siblings,
                quote,
                [...existingSiblings, ...uniqueNewNodes]
              );
            }
          } else {
            returableLevelAsLevel.siblings = updateSiblingsForQuote(
              returableLevelAsLevel.siblings,
              quote,
              uniqueNewNodes
            );
          }
        }
      }
    }
  }

  return returnableLevels;
}

function storyTreeReducer(state: StoryTreeState, action: Action): StoryTreeState {
  switch (action.type) {
    case ACTIONS.START_STORY_TREE_LOAD:
      {
        return {
          ...state,
          storyTree: {
            post: {
              id: action.payload.rootNodeId,
              content: '',
              authorId: '',
              createdAt: ''
            },
            levels: [],
            error: null
          } as StoryTree
        };
      }
    
    case ACTIONS.SET_INITIAL_STORY_TREE_DATA:
    {
      return {
        ...state,
        storyTree: action.payload.storyTree,
      };
    }
    
    case ACTIONS.INCLUDE_NODES_IN_LEVELS:
      // should be able to handle new levels and new nodes, and other updates to levels and nodes
      {
        if (!state.storyTree) {
          console.error("StoryTree is not initialized");
          return state;
        }
        const updatedLevels = mergeLevels(state.storyTree.levels, action.payload);
        return {
          ...state,
          storyTree: { ...state.storyTree, levels: updatedLevels },
        };
      }

    case ACTIONS.SET_SELECTED_NODE:
      {
        if (!state.storyTree) {
          console.error("StoryTree is not initialized");
          return state;
        }

        const selectedNode: StoryTreeNode = action.payload;
        const updatedLevel = state.storyTree.levels.find(level => level.levelNumber === selectedNode.levelNumber);

        if (!updatedLevel) {
          console.error("Selected level not found");
          return state; // or handle the error as needed
        }

        // Create a new levels array
        const newLevels = [...state.storyTree.levels];
        
        // Update the level with the selected node
        newLevels[selectedNode.levelNumber] = {
          ...updatedLevel,
          selectedNode: selectedNode
        };
        
        // Truncate levels after the selected level if needed
        if (selectedNode.levelNumber < newLevels.length - 1) {
          newLevels.length = selectedNode.levelNumber + 1;
        }
        
        return {
          ...state,
          storyTree: {
            ...state.storyTree,
            levels: newLevels
          }
        };
      }

    case ACTIONS.SET_LAST_LEVEL:
      {
        if (!state.storyTree) {
          console.error("StoryTree is not initialized");
          return state;
        }
        const lastLevelNumberInStoryTree = state.storyTree.levels.length - 1;
        const lastLevelNumberInPayload = action.payload.levelNumber;
        if (lastLevelNumberInStoryTree + 1 !== lastLevelNumberInPayload) {
          console.error(`Last level in story tree (${lastLevelNumberInStoryTree + 1}) does not match last level in payload (${lastLevelNumberInPayload})`);
          return state;
        }
        const lastLevel : LastLevel = {
          levelNumber: lastLevelNumberInPayload,
          rootNodeId: state.storyTree.post.id,
        };
        const newLevels : Array<StoryTreeLevel | LastLevel> = [...state.storyTree.levels, lastLevel];
        return {
          ...state,
          storyTree: { ...state.storyTree, levels: newLevels }
        };
      }
    
    case ACTIONS.SET_ERROR:
      {
        let error: string | null = null;
        if (typeof action.payload === 'string') {
          error = action.payload;
        }
        return {
          ...state,
          error: error
        };
      }
    
    case ACTIONS.CLEAR_ERROR:
      {
        return {
          ...state,
          error: null
        };
      }
    
    default:
      return state;
  }
}

interface StoryTreeContextType {
  state: StoryTreeState;
  dispatch: React.Dispatch<Action>;
}

const StoryTreeContext = createContext<StoryTreeContextType | undefined>(undefined);

export function StoryTreeProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(storyTreeReducer, initialState);
  const userContext = useUser();

  // Use useLayoutEffect to synchronously inject the store and user context before child effects run.
  useLayoutEffect(() => {
    storyTreeOperator.setStore({ state, dispatch });
    storyTreeOperator.setUserContext(userContext);
  }, [state, dispatch, userContext]);

  return (
    <StoryTreeErrorBoundary>
      <StoryTreeContext.Provider value={{ state, dispatch }}>
        {children}
      </StoryTreeContext.Provider>
    </StoryTreeErrorBoundary>
  );
}

export function useStoryTree() {
  const context = useContext(StoryTreeContext);
  if (!context) {
    throw new Error('useStoryTree must be used within a StoryTreeProvider');
  }
  return context;
} 