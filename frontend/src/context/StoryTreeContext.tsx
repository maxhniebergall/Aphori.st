import React, { createContext, useContext, useReducer, ReactNode } from 'react';
import { storyTreeActions } from './StoryTreeActions';
import { StoryTreeState, Action, LoadingState, StoryTreeLevel, IdToIndexPair } from './types';

/*
 * Requirements:
 * - Global state management using React Context
 * - Comprehensive action types for all state changes
 * - Loading state management with defined states (IDLE, LOADING, ERROR, SUCCESS)
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
 */

import { ACTIONS } from './types';

export const LOADING_STATES: Record<LoadingState, LoadingState> = {
  IDLE: 'IDLE',
  LOADING: 'LOADING',
  ERROR: 'ERROR',
  SUCCESS: 'SUCCESS'
};

const initialState: StoryTreeState = {
  isLoading: false,
  isInitialized: false,
  rootNodeId: '',
  selectedQuote: null,
  levels: [],
  idToIndexPair: { indexMap: new Map() },
  error: null,
};

// Add loading delay threshold
const LOADING_DELAY_MS = 150;  // Only show loading state if operation takes longer than 150ms

function getLevelIndex(existingLevels: StoryTreeLevel[], level: StoryTreeLevel): number {
  return existingLevels.findIndex(existingLevel => existingLevel.rootNodeId === level.rootNodeId && existingLevel.levelNumber === level.levelNumber);
}

function mergeLevels(existingLevels: StoryTreeLevel[], existingIdToIndexPair: IdToIndexPair, newLevels: StoryTreeLevel[]): { updatedLevels: StoryTreeLevel[], updatedIdToIndexPair: IdToIndexPair } {
  // idToIndexPair: Record<string, { levelIndex: number, siblingIndex: number }>;
  // stores the index of the node in the levels array for fast lookup

  const returnableLevels = [...existingLevels];
  const returnableIdToIndexPair = { ...existingIdToIndexPair };

  for (const levelWithNewItems of newLevels) { 
    const levelIndex = getLevelIndex(existingLevels, levelWithNewItems);
    
    if (levelIndex === -1) {
       // if the level is not in the existing levels, append it to returnableLevels
      returnableLevels.push(levelWithNewItems);
      // Use the new level's index after appending.
      addNewLevelToIndex(levelWithNewItems, returnableLevels.length - 1);
    } else {
      // merge the new level with the existing level
      for (const [quote, newNodesAtLevel] of levelWithNewItems.siblings?.levelsMap) {
        const returnableSiblings = returnableLevels[levelIndex].siblings.levelsMap.get(quote);
        if (returnableSiblings) {
          returnableSiblings.push(...newNodesAtLevel);
        } else {
          returnableLevels[levelIndex].siblings.levelsMap.set(quote, [...newNodesAtLevel]);
        }
      } 
      // Use the existing level's index when merging.
      addNewLevelToIndex(levelWithNewItems, levelIndex);
    }
  }

  return { updatedLevels: returnableLevels, updatedIdToIndexPair: returnableIdToIndexPair };

  // Updated helper: now accepts the correct level index as a parameter.
  function addNewLevelToIndex(levelWithNewItems: StoryTreeLevel, levelIndex: number) {
    const countOfNodesUsingQuote = new Map<string, number>();
    for (const [quote, newNodesAtLevel] of levelWithNewItems.siblings?.levelsMap) {
      for (const newNodeAtLevel of newNodesAtLevel) {
        const currentCount = countOfNodesUsingQuote.get(quote.quoteLiteral) || 0;
        returnableIdToIndexPair.indexMap.set(newNodeAtLevel.id,
          { levelIndex: levelIndex, siblingIndex: currentCount });
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
        rootNodeId: action.payload.rootNodeId,
        error: null
      };
    
    case ACTIONS.SHOW_LOADING_INDICATOR:
      return {
        ...state,
        isLoading: action.payload
      };
    
    case ACTIONS.SET_STORY_TREE_DATA:
      return {
        ...state,
        levels: action.payload.levels,
        idToIndexPair: action.payload.idToIndexPair,
        isLoading: false,
        isInitialized: true,
        error: null
      };
    
    case ACTIONS.INCLUDE_NODES_IN_LEVELS:
      const { updatedLevels, updatedIdToIndexPair } = mergeLevels(state.levels, state.idToIndexPair, action.payload)
      return {
        ...state,
        levels: updatedLevels,
        idToIndexPair: updatedIdToIndexPair
      };
    
    case ACTIONS.NEW_REPLY_FROM_USER:
      // Create a new StoryTreeLevel from the reply
      const newReplyLevel: StoryTreeLevel = {
        rootNodeId: state.rootNodeId,
        levelNumber: state.levels.length, // New reply goes to next level
        textContent: action.payload.content,
        siblings: {
          levelsMap: new Map([[
            action.payload.quote || {
              quoteLiteral: action.payload.content,
              sourcePostId: action.payload.targetId
            },
            [{
              id: crypto.randomUUID(),
              parentId: [action.payload.targetId],
              Quote: action.payload.content,
              textContent: action.payload.content
            }]
          ]])
        }
      };
      
      const { updatedLevels: levelsWithNewReply, updatedIdToIndexPair: idToIndexPairWithNewReply } = 
        mergeLevels(state.levels, state.idToIndexPair, [newReplyLevel]);
      
      return {
        ...state,
        levels: levelsWithNewReply,
        idToIndexPair: idToIndexPairWithNewReply
      };
    
    case ACTIONS.SET_SELECTED_QUOTE:
      return {
        ...state,
        selectedQuote: action.payload
      };

    case ACTIONS.SET_ERROR:
      return {
        ...state,
        error: action.payload,
        isLoading: false
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
  actions: typeof storyTreeActions;
}

const StoryTreeContext = createContext<StoryTreeContextType | undefined>(undefined);

interface StoryTreeErrorBoundaryProps {
  children: ReactNode;
}

interface StoryTreeErrorBoundaryState {
  hasError: boolean;
}

class StoryTreeErrorBoundary extends React.Component<
  StoryTreeErrorBoundaryProps,
  StoryTreeErrorBoundaryState
> {
  constructor(props: StoryTreeErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): StoryTreeErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('StoryTree Error:', error, errorInfo);
  }

  render(): React.ReactElement {
    if (this.state.hasError) {
      return (
        <div className="story-tree-error">
          <h2>Something went wrong.</h2>
          <button onClick={() => window.location.reload()}>
            Refresh Page
          </button>
        </div>
      );
    }

    return <>{this.props.children}</>;
  }
}

interface StoryTreeProviderProps {
  children: ReactNode;
}

export function StoryTreeProvider({ children }: StoryTreeProviderProps) {
  const [state, dispatch] = useReducer(storyTreeReducer, initialState);
  const value = {
    state,
    dispatch,
    actions: storyTreeActions
  };

  return (
    <StoryTreeErrorBoundary>
      <StoryTreeContext.Provider value={value}>
        {children}
      </StoryTreeContext.Provider>
    </StoryTreeErrorBoundary>
  );
}

export function StoryTreeLoading(): React.ReactElement {
  return (
    <div className="story-tree-loading">
      <div className="loading-spinner"></div>
      <p>Loading story tree...</p>
    </div>
  );
}

export function useStoryTree(): StoryTreeContextType {
  const context = useContext(StoryTreeContext);
  if (!context) {
    throw new Error('useStoryTree must be used within a StoryTreeProvider');
  }
  return context;
} 