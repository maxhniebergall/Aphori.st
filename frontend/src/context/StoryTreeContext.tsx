import React, { createContext, useContext, useReducer, useLayoutEffect, ReactNode } from 'react';
import { StoryTreeState, Action, StoryTreeLevel } from '../types/types';
import { ACTIONS } from '../types/types';
import StoryTreeErrorBoundary from './StoryTreeErrorBoundary';
import storyTreeOperator from '../operators/StoryTreeOperator';
import { useUser } from './UserContext';

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

function getLevelIndex(existingLevels: StoryTreeLevel[], level: StoryTreeLevel): number {
  return existingLevels.findIndex(existingLevel => 
    existingLevel.rootNodeId === level.rootNodeId && 
    existingLevel.levelNumber === level.levelNumber
  );
}

export function mergeLevels(existingLevels: StoryTreeLevel[], newLevels: StoryTreeLevel[]): StoryTreeLevel[] {
  const returnableLevels = [...existingLevels];

  for (const levelWithNewItems of newLevels) { 
    const levelIndex = getLevelIndex(existingLevels, levelWithNewItems);
    
    if (levelIndex === -1) {
      returnableLevels.push(levelWithNewItems);
    } else {
      // Update the pagination information with cursor based details
      returnableLevels[levelIndex].pagination = {
        ...returnableLevels[levelIndex].pagination,
        ...levelWithNewItems.pagination
      };

      // Merge siblings map using cursor based pagination.
      // Instead of using an index for insertion, check for the existence of prevCursor:
      // if prevCursor exists, the new nodes are from an earlier page and should be prepended;
      // otherwise, they are appended.
      if (levelWithNewItems.siblings?.levelsMap) {
        for (const [quote, newNodesAtLevel] of levelWithNewItems.siblings.levelsMap) {
          const existingSiblings = returnableLevels[levelIndex].siblings.levelsMap.get(quote);        
          // Filter out nodes that already exist
          const existingIds = existingSiblings ? new Set(existingSiblings.map(node => node.id)) : new Set();
          const uniqueNewNodes = newNodesAtLevel.filter(node => !existingIds.has(node.id));
          
          if (existingSiblings && existingSiblings.length > 0) {
            if (levelWithNewItems.pagination.prevCursor) {
              // Prepend new nodes if pagination indicates loading a previous page.
              returnableLevels[levelIndex].siblings.levelsMap.set(quote, [...uniqueNewNodes, ...existingSiblings]);
            } else {
              // Otherwise, append new nodes.
              returnableLevels[levelIndex].siblings.levelsMap.set(quote, [...existingSiblings, ...uniqueNewNodes]);
            }
          } else {
            returnableLevels[levelIndex].siblings.levelsMap.set(quote, uniqueNewNodes);
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
      return {
        ...state,
        storyTree: {
          id: action.payload.rootNodeId,
          parentId: null,
          metadata: {
            authorId: '',
            createdAt: '',
            quote: null
          },
          levels: [],
          error: null
        }
      };
    
    case ACTIONS.SET_INITIAL_STORY_TREE_DATA:
      return {
        ...state,
        storyTree: action.payload.storyTree,
      };
    
    case ACTIONS.INCLUDE_NODES_IN_LEVELS:
      if (!state.storyTree) {
        console.error("StoryTree is not initialized");
        return state;
      }
      const updatedLevels = mergeLevels(state.storyTree.levels, action.payload);
      return {
        ...state,
        storyTree: { ...state.storyTree, levels: updatedLevels },
      };
    
    case ACTIONS.SET_ERROR:
      return {
        ...state,
        error: action.payload
      };

    case ACTIONS.CLEAR_ERROR:
      return {
        ...state,
        error: null
      };
    
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