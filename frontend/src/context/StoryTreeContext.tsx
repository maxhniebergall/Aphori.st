import React, { createContext, useContext, useReducer, ReactNode, useEffect } from 'react';
import { StoryTreeState, Action, StoryTreeLevel, IdToIndexPair } from '../types/types';
import { ACTIONS } from '../types/types';
import StoryTreeErrorBoundary from '../context/StoryTreeErrorBoundary';
import StoryTreeOperator from '../operators/StoryTreeOperator';

/*
 * Requirements:
 * - Global state management using React Context
 * - Comprehensive action types for all state changes
 * - Loading state management with simple boolean isLoading
 * - Error handling and propagation
 * - Initial state with proper type definitions
 * - Pagination state management
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

function mergeLevels(existingLevels: StoryTreeLevel[], existingIdToIndexPair: IdToIndexPair, newLevels: StoryTreeLevel[]): { updatedLevels: StoryTreeLevel[], updatedIdToIndexPair: IdToIndexPair } {
  const returnableLevels = [...existingLevels];
  const returnableIdToIndexPair = { ...existingIdToIndexPair };

  for (const levelWithNewItems of newLevels) { 
    const levelIndex = getLevelIndex(existingLevels, levelWithNewItems);
    
    if (levelIndex === -1) {
      returnableLevels.push(levelWithNewItems);
      addNewLevelToIndex(levelWithNewItems, returnableLevels.length - 1);
    } else {
      for (const [quote, newNodesAtLevel] of levelWithNewItems.siblings?.levelsMap) {
        const returnableSiblings = returnableLevels[levelIndex].siblings.levelsMap.get(quote);
        if (returnableSiblings) {
          returnableSiblings.push(...newNodesAtLevel);
        } else {
          returnableLevels[levelIndex].siblings.levelsMap.set(quote, [...newNodesAtLevel]);
        }
      } 
      addNewLevelToIndex(levelWithNewItems, levelIndex);
    }
  }

  return { updatedLevels: returnableLevels, updatedIdToIndexPair: returnableIdToIndexPair };

  function addNewLevelToIndex(levelWithNewItems: StoryTreeLevel, levelIndex: number) {
    // TODO FIXME what is even happening here?
    const countOfNodesUsingQuote = new Map<string, number>();
    for (const [quote, newNodesAtLevel] of levelWithNewItems.siblings?.levelsMap) {
      for (const newNodeAtLevel of newNodesAtLevel) {
        // Retrieve the current count for this quote.
        const currentCount = countOfNodesUsingQuote.get(quote.quoteLiteral) || 0;
        // Update the index map with the levelIndex and the node's sibling order.
        returnableIdToIndexPair.indexMap.set(newNodeAtLevel.id,
          { levelIndex: levelIndex, siblingIndex: currentCount });
        // Increment the counter for nodes with this quote.
        countOfNodesUsingQuote.set(quote.quoteLiteral, currentCount + 1);
      }
    }
  }
}

function storyTreeReducer(state: StoryTreeState, action: Action): StoryTreeState {
  switch (action.type) {
    case ACTIONS.START_STORY_TREE_LOAD:
      return {
        ...state,
        storyTree: {
          ...state.storyTree,
          id: action.payload.rootNodeId,
          parentId: null,
          metadata: {
            title: '',
            author: '',
            authorId: '',
            authorEmail: '',
            createdAt: '',
            quote: null
          },
          levels: [],
          idToIndexPair: { indexMap: new Map() },
          error: null
        }
      };
    
    case ACTIONS.SET_INITIAL_STORY_TREE_DATA:
      return {
        ...state,
        storyTree: action.payload.storyTree,
      };
    
    case ACTIONS.INCLUDE_NODES_IN_LEVELS:
      const { updatedLevels, updatedIdToIndexPair } = mergeLevels(state.storyTree?.levels ?? [], state.storyTree?.idToIndexPair ?? { indexMap: new Map() }, action.payload)
      return {
        ...state,
        storyTree: {
          ...state.storyTree,
          levels: updatedLevels,
          idToIndexPair: updatedIdToIndexPair
        }
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
}

const StoryTreeContext = createContext<StoryTreeContextType | undefined>(undefined);

export function StoryTreeProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(storyTreeReducer, initialState);

  // Initialize the operator's dispatch so that all state updates
  // are routed through the operator.
  useEffect(() => {
    // Set the private dispatch on the operator.
    // This makes dispatch available only inside StoryTreeOperator.
    StoryTreeOperator.setDispatch(dispatch);
  }, [dispatch]);

  // Provide only the state to consumers.
  const value = { state };

  return (
    <StoryTreeErrorBoundary>
      <StoryTreeContext.Provider value={value}>
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