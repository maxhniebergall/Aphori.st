import React, { createContext, useContext, useReducer, useLayoutEffect, ReactNode } from 'react';
import { StoryTreeState, Action, StoryTreeLevel, StoryTree, StoryTreeNode, Siblings, LastLevel } from '../types/types';
import { ACTIONS } from '../types/types';
import StoryTreeErrorBoundary from './StoryTreeErrorBoundary';
import storyTreeOperator from '../operators/StoryTreeOperator';
import { useUser } from './UserContext';
import { Quote } from '../types/quote';
import { 
  getRootNodeId, 
  getLevelNumber,
  getPagination,
  getSiblings,
  setSelectedNodeHelper,
  createLastLevel,
  isMidLevel,
  isLastLevel,
  updateSiblingsForQuoteHelper
} from '../utils/levelDataHelpers';

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
  isLoadingMore: false,
};

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

export function mergeLevels(existingLevels: Array<StoryTreeLevel>, newLevelsPayload: Array<StoryTreeLevel>): Array<StoryTreeLevel> {
  const processedNewLevelIndices = new Set<number>();
  let overallChange = false; // Track if any level object reference changes

  const potentiallyUpdatedLevels = existingLevels.map(existingLevel => {
    // Find corresponding level data in the payload
    const newLevelIndex = newLevelsPayload.findIndex(newLevel =>
      getRootNodeId(newLevel) === getRootNodeId(existingLevel) &&
      getLevelNumber(newLevel) === getLevelNumber(existingLevel)
    );

    if (newLevelIndex === -1) {
      // No new data for this existing level, return original reference
      return existingLevel;
    }

    const newLevelData = newLevelsPayload[newLevelIndex];
    processedNewLevelIndices.add(newLevelIndex);

    if (newLevelData.isLastLevel) {
      console.warn(`Attempted to merge LastLevel into existing Level ${getLevelNumber(existingLevel)}. Ignoring payload for this level.`);
      return existingLevel;
    }
    if (!isMidLevel(existingLevel) || !existingLevel.midLevel) {
      console.warn(`Attempted to merge into non-MidLevel or invalid existing Level ${getLevelNumber(existingLevel)}. Ignoring payload for this level.`);
      return existingLevel;
    }
    if (!isMidLevel(newLevelData) || !newLevelData.midLevel) {
      console.warn(`Payload for level ${getLevelNumber(existingLevel)} is not a valid MidLevel. Ignoring payload.`);
      return existingLevel;
    }

    let currentLevel = existingLevel;
    let currentMidLevel = existingLevel.midLevel;
    let currentSiblings = currentMidLevel.siblings;
    let siblingsChanged = false; // Track if siblings reference changes

    // Get the latest pagination info from the payload, regardless of whether it changed
    const latestPagination = newLevelData.midLevel.pagination ?? currentMidLevel.pagination;

    // Merge Nodes/Siblings
    const newSiblingsPayload = newLevelData.midLevel.siblings;
    if (newSiblingsPayload?.levelsMap) {
      for (const [quote, newNodesForQuote] of newSiblingsPayload.levelsMap) {
        const existingNodesForQuote = findSiblingsForQuote(currentSiblings, quote);
        const existingIds = new Set(existingNodesForQuote.map(node => node.id));
        const uniqueNewNodes = newNodesForQuote.filter(node => !existingIds.has(node.id));

        if (uniqueNewNodes.length === 0) {
          continue;
        }

        let finalNodesForQuote;
        const newLevelPagination = getPagination(newLevelData); // Use pagination from *new* data for prepend/append logic
        if (newLevelPagination?.prevCursor) {
          finalNodesForQuote = [...uniqueNewNodes, ...existingNodesForQuote];
        } else {
          finalNodesForQuote = [...existingNodesForQuote, ...uniqueNewNodes];
        }

        const updatedSiblingsResult = updateSiblingsForQuoteHelper(
          currentSiblings,
          quote,
          finalNodesForQuote
        );

        if (updatedSiblingsResult !== currentSiblings) {
          currentSiblings = updatedSiblingsResult; // Update siblings reference
          siblingsChanged = true; // Mark that siblings object *did* change
        }
      }
    }

    // If siblings changed, update midLevel and level references
    if (siblingsChanged) {
        // Create new midLevel object containing the new siblings reference and the latest pagination
        currentMidLevel = { 
            ...currentMidLevel, // Spread existing midLevel to preserve other properties
            siblings: currentSiblings, 
            pagination: latestPagination // Include the most recent pagination info
        };
        // Create new level object wrapping the new midLevel
        currentLevel = { ...existingLevel, midLevel: currentMidLevel };
        overallChange = true; // Mark that an object reference *did* change
        return currentLevel; 
    } else {
        // Siblings did not change, BUT we might still need to update the pagination *within* the existing midLevel reference
        // if it changed in the payload.
        if (latestPagination !== existingLevel.midLevel.pagination && JSON.stringify(latestPagination) !== JSON.stringify(existingLevel.midLevel.pagination)) {
             // Mutate pagination directly ONLY IF siblings didn't change.
             // This is less ideal than full immutability but avoids level reference change.
             // Consider if a more complex structure is needed if this becomes problematic.
             existingLevel.midLevel.pagination = latestPagination; 
             // Note: We *don't* set overallChange = true here, as the level reference itself didn't change.
        }
        // No change in siblings, return the original level object reference
        return existingLevel;
    }
  });

  // Append any completely new levels from the payload
  const completelyNewLevels = newLevelsPayload.filter((_, index) => !processedNewLevelIndices.has(index));
  if (completelyNewLevels.length > 0) {
    overallChange = true; // Adding new levels is a change
    // Note: Potentially mutated pagination in existing levels won't be reflected 
    // unless we use potentiallyUpdatedLevels here. Decide based on desired behavior.
    // If mutation above is acceptable, we might return existingLevels if overallChange remains false.
    // Let's stick to returning the mapped array + new levels for now.
     return [...potentiallyUpdatedLevels, ...completelyNewLevels];
  }

  // Return original array *only* if no levels were added AND no existing level references were changed.
  return overallChange ? potentiallyUpdatedLevels : existingLevels;
}

function storyTreeReducer(state: StoryTreeState, action: Action): StoryTreeState {
  let nextState: StoryTreeState = state;
  switch (action.type) {
    case ACTIONS.START_STORY_TREE_LOAD:
      {
        nextState = {
          ...state,
          isLoadingMore: true,
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
        break;
      }
    
    case ACTIONS.SET_INITIAL_STORY_TREE_DATA:
    {
      if (!action.payload.storyTree) {
        nextState = {
          ...state,
          isLoadingMore: false,
          error: action.payload.error || state.error,
          storyTree: null,
        };
      } else {
        nextState = {
          ...state,
          isLoadingMore: false,
          error: null,
          storyTree: action.payload.storyTree,
        };
      }
      break;
    }
    
    case ACTIONS.INCLUDE_NODES_IN_LEVELS:
      {
        if (!state.storyTree) {
          console.error("StoryTree is not initialized");
          return state;
        }
        const updatedLevels = mergeLevels(state.storyTree.levels, action.payload);
        const updatedLevelNumbers = action.payload.map(lvl => getLevelNumber(lvl)).filter((n): n is number => typeof n === 'number');
        const maxUpdatedLevel = updatedLevelNumbers.length > 0 ? Math.max(...updatedLevelNumbers) : updatedLevels.length - 1;
        const truncatedLevels = updatedLevels.slice(0, maxUpdatedLevel + 1);
        nextState = {
          ...state,
          storyTree: { ...state.storyTree, levels: truncatedLevels },
        };
        break;
      }

    case ACTIONS.SET_SELECTED_NODE:
      {
        if (!state.storyTree) {
          console.error("SET_SELECTED_NODE: StoryTree is not initialized");
          return state;
        }

        const selectedNode: StoryTreeNode = action.payload;
        const targetLevelNumber = selectedNode.levelNumber;

        // Use .map() for immutable update, similar to UPDATE_LEVEL_SELECTED_QUOTE
        const newLevels = state.storyTree.levels.map(level => {
          if (getLevelNumber(level) === targetLevelNumber) {
            // Call helper to get the immutably updated level object
            // This helper already creates new level and midLevel objects internally
            return setSelectedNodeHelper(level, selectedNode);
          } else {
            // Return original object reference for other levels
            return level;
          }
        });

        nextState = {
          ...state,
          storyTree: {
            ...state.storyTree,
            levels: newLevels as StoryTreeLevel[] // Use newLevels directly
          }
        };
        break;
      }

    case ACTIONS.UPDATE_LEVEL_SELECTED_QUOTE:
      {
        if (!state.storyTree) {
          console.error("UPDATE_LEVEL_SELECTED_QUOTE: StoryTree is not initialized");
          return state;
        }
        const { levelNumber: targetLevelNumber, newQuote } = action.payload;

        // No explicit type here, let map infer
        const newLevels = state.storyTree.levels.map(level => {
          // Only modify the target level
          if (getLevelNumber(level) === targetLevelNumber) {
            // Ensure it's a MidLevel before updating
            if (isMidLevel(level) && level.midLevel) {
              // Return a *new* level object with the *new* midLevel object containing the new quote
              return {
                ...level,
                midLevel: {
                  ...level.midLevel,
                  selectedQuote: newQuote
                }
              };
            } else {
              console.warn(`UPDATE_LEVEL_SELECTED_QUOTE: Attempted to update non-MidLevel or invalid MidLevel at index ${targetLevelNumber}`);
              return level; // Return original if not a valid MidLevel to update
            }
          } else {
            // For all other levels, return the original object reference
            return level;
          }
        });

        nextState = {
          ...state,
          storyTree: {
            ...state.storyTree,
            levels: newLevels as StoryTreeLevel[]
          }
        };
        break;
      }

    case ACTIONS.SET_LAST_LEVEL:
      {
        if (!state.storyTree) {
          console.error("StoryTree is not initialized");
          return state;
        }
        // We still need the rootNodeId from the state's post
        if (!state.storyTree.post?.id) {
           console.error("SET_LAST_LEVEL: Cannot determine rootNodeId from post");
           return state; // Or set error
        }
        const rootNodeId = state.storyTree.post.id;
        const lastLevelNumberInPayload = action.payload.levelNumber;
        
        // Create the LastLevel data part
        const lastLevelData: LastLevel = { 
            levelNumber: lastLevelNumberInPayload, 
            rootNodeId: rootNodeId 
        };

        // Create the full StoryTreeLevel object representing the last level
        const lastLevelAsStoryTreeLevel: StoryTreeLevel = {
            isLastLevel: true,
            midLevel: null,
            lastLevel: lastLevelData
        };

        // Append this correctly typed object
        // Ensure the array type matches the updated StoryTree.levels type
        const newLevels : Array<StoryTreeLevel> = [
            ...state.storyTree.levels,
             lastLevelAsStoryTreeLevel
        ]; 

        nextState = {
          ...state,
          storyTree: { ...state.storyTree, levels: newLevels }
        };
        break;
      }
    
    case ACTIONS.SET_ERROR:
      {
        nextState = {
          ...state,
          isLoadingMore: false,
          error: action.payload
        };
        break;
      }
    
    case ACTIONS.CLEAR_ERROR:
      {
        nextState = {
          ...state,
          error: null
        };
        break;
      }

    case ACTIONS.REPLACE_LEVEL_DATA:
      {
        if (!state.storyTree) {
          console.error("REPLACE_LEVEL_DATA: StoryTree is not initialized");
          return state;
        }
        const newLevel = action.payload;
        const levelNumberToReplace = getLevelNumber(newLevel);
        if (levelNumberToReplace === null) {
          console.error("REPLACE_LEVEL_DATA: Invalid level number in payload", newLevel);
          return state;
        }

        const currentLevels = state.storyTree.levels;
        const levelIndex = currentLevels.findIndex(level => getLevelNumber(level) === levelNumberToReplace);

        let updatedLevels;
        if (levelIndex !== -1) {
          // Replace existing level
          updatedLevels = [
            ...currentLevels.slice(0, levelIndex),
            newLevel,
            ...currentLevels.slice(levelIndex + 1)
          ];
        } else if (levelNumberToReplace === currentLevels.length) {
          // Append new level if it's the next one
          updatedLevels = [...currentLevels, newLevel];
        } else {
          console.error(`REPLACE_LEVEL_DATA: Cannot replace level ${levelNumberToReplace}. It does not exist and is not the next level (${currentLevels.length}).`);
          return state; // Or set an error state
        }

        nextState = {
          ...state,
          storyTree: { ...state.storyTree, levels: updatedLevels },
        };
        break;
      }

    case ACTIONS.CLEAR_LEVELS_AFTER:
      {
        if (!state.storyTree) {
          console.error("CLEAR_LEVELS_AFTER: StoryTree is not initialized");
          return state;
        }
        const targetLevelNumber = action.payload.levelNumber;
        const filteredLevels = state.storyTree.levels.filter(level => {
          const levelNum = getLevelNumber(level);
          // Use explicit if/else for clearer type narrowing
          if (levelNum === null || levelNum === undefined) {
            // If levelNum is null, this level should not be kept
            return false;
          } else {
            // Now levelNum is confirmed to be a number
            // Keep levels up to and including the target level number
            return levelNum <= targetLevelNumber;
          }
        });

        nextState = {
          ...state,
          storyTree: { ...state.storyTree, levels: filteredLevels },
        };
        break;
      }

    case ACTIONS.SET_LOADING_MORE:
      {
        const isLoading = typeof action.payload === 'boolean' ? action.payload : false;
        nextState = {
          ...state,
          isLoadingMore: isLoading,
        };
        break;
      }
    
    default:
      nextState = state;
  }
  return nextState;
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