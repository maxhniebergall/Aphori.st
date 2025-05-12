import React, { createContext, useContext, useReducer, useLayoutEffect, ReactNode, useEffect } from 'react';
import { PostTreeState, Action, PostTreeLevel, PostTree, PostTreeNode, Siblings, LastLevel, NavigationRequest } from '../types/types';
import { ACTIONS } from '../types/types';
import PostTreeErrorBoundary from './PostTreeErrorBoundary';
import postTreeOperator from '../operators/PostTreeOperator';
import { useUser } from './UserContext';
import { Quote, areQuotesEqual } from '../types/quote';
import { 
  getRootNodeId, 
  getLevelNumber,
  getPagination,
  isMidLevel,
  setSelectedNodeHelper,
  setSelectedQuoteInThisLevelHelper,
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
 * - Support for nested postTree structure in node objects
 * - Proper type checking for node structure
 * - Handle quote metadata
 * - Support for reply-based navigation
 * - TypeScript type safety and interfaces
 * - Provide state to UI components without exposing dispatch.
 * - Dispatch is centralized in PostTreeOperator to handle all state updates.
 */

const initialState: PostTreeState = {
  postTree: null,
  error: null,
  isLoadingMore: false,
  navigationRequest: null,
};

// Helper function to find siblings for a quote in the array-based structure
/* // This function is obsolete with the new Siblings structure
function findSiblingsForQuote(siblings: Siblings, quote: Quote | null): PostTreeNode[] {
  const entry = siblings.levelsMap.find(([key]) => {
    if (key === null && quote === null) {
      return true;
    }
    if (!key || !quote) {
      return false;
    }
    return key.sourceId === quote.sourceId && 
           key.text === quote.text &&
           key.selectionRange.start === quote.selectionRange.start &&
           key.selectionRange.end === quote.selectionRange.end;
  });
  
  return entry ? entry[1] : [];
}
*/

export function mergeLevels(existingLevels: PostTreeLevel[], newLevelsPayload: PostTreeLevel[]): PostTreeLevel[] {
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
    let currentSiblingsNodes = currentMidLevel.siblings.nodes; // Changed from .siblings to .siblings.nodes
    let siblingsNodesChanged = false; // Track if siblings.nodes reference changes

    // Get the latest pagination info from the payload, regardless of whether it changed
    const latestPagination = newLevelData.midLevel.pagination ?? currentMidLevel.pagination;

    // Merge Nodes/Siblings
    const newSiblingsNodesPayload = newLevelData.midLevel.siblings.nodes; // Changed
    if (newSiblingsNodesPayload) {
      // With the new model, the payload for siblings.nodes is expected to be the complete, sorted list for this level.
      // So, we replace if different. We could add more complex merging (append/prepend) if pagination logic changes.
      const existingIds = new Set(currentSiblingsNodes.map(node => node.id));
      const uniqueNewNodes = newSiblingsNodesPayload.filter(node => !existingIds.has(node.id));

      // For now, assume newSiblingsNodesPayload is the definitive new list if it differs, 
      // or append if it represents a paginated addition.
      // Let's simplify to replacement if it's different, assuming operator provides full sorted list for now.
      if (JSON.stringify(currentSiblingsNodes) !== JSON.stringify(newSiblingsNodesPayload)) {
        currentSiblingsNodes = newSiblingsNodesPayload; // Replace with the new list
        siblingsNodesChanged = true;
      }
    }

    // If siblings.nodes changed, update midLevel and level references
    if (siblingsNodesChanged) {
        currentMidLevel = { 
            ...currentMidLevel, 
            siblings: { nodes: currentSiblingsNodes }, // Assign new Siblings object
            pagination: latestPagination 
        };
        currentLevel = { ...existingLevel, midLevel: currentMidLevel };
        overallChange = true; 
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

function postTreeReducer(state: PostTreeState, action: Action): PostTreeState {
  let nextState: PostTreeState = state;
  switch (action.type) {
    case ACTIONS.START_POST_TREE_LOAD:
      {
        nextState = {
          ...state,
          isLoadingMore: true,
          postTree: {
            post: {
              id: action.payload.rootNodeId,
              content: '',
              authorId: '',
              createdAt: ''
            },
            levels: [],
            error: null
          } as PostTree
        };
        break;
      }
    
    case ACTIONS.SET_INITIAL_POST_TREE_DATA:
    {
      if (!action.payload.postTree) {
        nextState = {
          ...state,
          isLoadingMore: false,
          error: action.payload.error || state.error,
          postTree: null,
        };
      } else {
        nextState = {
          ...state,
          isLoadingMore: false,
          error: null,
          postTree: action.payload.postTree,
        };
      }
      break;
    }
    
    case ACTIONS.INCLUDE_NODES_IN_LEVELS:
      {
        if (!state.postTree) {
          console.error("PostTree is not initialized");
          return state;
        }
        const updatedLevels = mergeLevels(state.postTree.levels, action.payload);
        const updatedLevelNumbers = action.payload.map(lvl => getLevelNumber(lvl)).filter((n): n is number => typeof n === 'number');
        const maxUpdatedLevel = updatedLevelNumbers.length > 0 ? Math.max(...updatedLevelNumbers) : updatedLevels.length - 1;
        const truncatedLevels = updatedLevels.slice(0, maxUpdatedLevel + 1);
        nextState = {
          ...state,
          postTree: { ...state.postTree, levels: truncatedLevels },
        };
        break;
      }

    case ACTIONS.SET_SELECTED_NODE:
      {
        if (!state.postTree) {
          console.error("SET_SELECTED_NODE: PostTree is not initialized");
          return state;
        }

        const selectedNode: PostTreeNode = action.payload;
        const targetLevelNumber = selectedNode.levelNumber;

        // Use .map() for immutable update, similar to UPDATE_LEVEL_SELECTED_QUOTE
        const newLevels = state.postTree.levels.map(level => {
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
          postTree: {
            ...state.postTree,
            levels: newLevels // Use newLevels directly
          }
        };
        break;
      }

    case ACTIONS.UPDATE_THIS_LEVEL_SELECTED_QUOTE:
      {
        if (!state.postTree) {
          console.error("UPDATE_THIS_LEVEL_SELECTED_QUOTE: PostTree is not initialized");
          return state;
        }
        const { levelNumber: targetLevelNumber, newQuote } = action.payload;

        const newLevels = state.postTree.levels.map(level => {
          if (getLevelNumber(level) === targetLevelNumber) {
             // Use the helper function to update the quote immutably
            return setSelectedQuoteInThisLevelHelper(level, newQuote);
          } else {
            // For all other levels, return the original object reference
            return level;
          }
        });

        nextState = {
          ...state,
          postTree: {
            ...state.postTree,
            levels: newLevels
          }
        };
        break;
      }

    case ACTIONS.SET_LAST_LEVEL:
      {
        if (!state.postTree) {
          console.error("SET_LAST_LEVEL: PostTree is not initialized");
          return state;
        }
        if (!state.postTree.post?.id) {
           console.error("SET_LAST_LEVEL: Cannot determine rootNodeId from post");
           return state; // Or set error
        }
        const rootNodeId = state.postTree.post.id;
        const lastLevelNumberInPayload = action.payload.levelNumber;

        // Create the LastLevel data part
        const lastLevelData: LastLevel = {
            levelNumber: lastLevelNumberInPayload,
            rootNodeId: rootNodeId
        };

        // Create the full PostTreeLevel object representing the last level
        const lastLevelAsPostTreeLevel: PostTreeLevel = {
            isLastLevel: true,
            midLevel: null, // Keep midLevel as null
            lastLevel: lastLevelData
        };

        // Find if the level already exists
        const levelIndex = state.postTree.levels.findIndex(level => getLevelNumber(level) === lastLevelNumberInPayload);

        let newLevels: PostTreeLevel[];
        if (levelIndex !== -1) {
           // If level already exists, replace it and truncate any subsequent levels
           console.log(`[Reducer SET_LAST_LEVEL] Replacing existing level ${lastLevelNumberInPayload} at index ${levelIndex} with LastLevel object.`);
           newLevels = [
               ...state.postTree.levels.slice(0, levelIndex),
               lastLevelAsPostTreeLevel
               // Truncate levels after this index
           ];
        } else if (lastLevelNumberInPayload === state.postTree.levels.length) {
            // If the level doesn't exist yet and it's the next sequential level, append it
             console.log(`[Reducer SET_LAST_LEVEL] Appending LastLevel object for new level ${lastLevelNumberInPayload}.`);
            newLevels = [
               ...state.postTree.levels,
               lastLevelAsPostTreeLevel
           ];
        } else {
            // Error case: Trying to set LastLevel for a non-existent, non-sequential level
            console.error(`SET_LAST_LEVEL: Cannot set LastLevel for non-sequential level ${lastLevelNumberInPayload}. Current length: ${state.postTree.levels.length}. State unchanged.`);
            return state; // Return unchanged state
        }

        nextState = {
          ...state,
          postTree: { ...state.postTree, levels: newLevels }
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
        if (!state.postTree) {
          console.error("REPLACE_LEVEL_DATA: PostTree is not initialized");
          return state;
        }
        const newLevelPayload = action.payload;
        const levelNumberToReplace = getLevelNumber(newLevelPayload);
        if (levelNumberToReplace === null) {
          console.error("REPLACE_LEVEL_DATA: Invalid level number in payload", newLevelPayload);
          return state;
        }

        const currentLevels = state.postTree.levels;
        const levelIndex = currentLevels.findIndex(level => getLevelNumber(level) === levelNumberToReplace);

        let updatedLevels;
        let levelToInsert = newLevelPayload;

        if (isMidLevel(levelToInsert) && levelToInsert.midLevel) {
            // const parentQuote = levelToInsert.midLevel.selectedQuoteInParent; // No longer used to find sibling list
            const newSiblingNodes = levelToInsert.midLevel.siblings.nodes;
            let firstSibling: PostTreeNode | undefined = undefined;

            if (newSiblingNodes && newSiblingNodes.length > 0) {
                firstSibling = newSiblingNodes[0];
            }

            if (firstSibling && levelToInsert.midLevel.selectedNode?.id !== firstSibling.id) {
                console.warn(`REPLACE_LEVEL_DATA: Payload selectedNode ID (${levelToInsert.midLevel.selectedNode?.id}) mismatch with first sibling ID (${firstSibling.id}). Correcting.`);
                levelToInsert = setSelectedNodeHelper(levelToInsert, firstSibling);
            } else if (!firstSibling && levelToInsert.midLevel.selectedNode) {
                 console.warn(`REPLACE_LEVEL_DATA: Payload has selectedNode but no siblings found. Proceeding with original payload selectedNode.`);
            }
        }

        if (levelIndex !== -1) {
          updatedLevels = [
            ...currentLevels.slice(0, levelIndex),
            levelToInsert,
            ...currentLevels.slice(levelIndex + 1)
          ];
        } else if (levelNumberToReplace === currentLevels.length) {
          updatedLevels = [...currentLevels, levelToInsert];
        } else {
          console.error(`REPLACE_LEVEL_DATA: Cannot replace level ${levelNumberToReplace}. Invalid index.`);
          return state;
        }

        nextState = {
          ...state,
          postTree: { ...state.postTree, levels: updatedLevels },
        };
        break;
      }

    case ACTIONS.CLEAR_LEVELS_AFTER:
      {
        if (!state.postTree) {
          console.error("CLEAR_LEVELS_AFTER: PostTree is not initialized");
          return state;
        }
        const targetLevelNumber = action.payload.levelNumber;
        const filteredLevels = state.postTree.levels.filter(level => {
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
          postTree: { ...state.postTree, levels: filteredLevels },
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

    case ACTIONS.NAVIGATE_NEXT_SIBLING:
      {
        console.log(`[Reducer] Received NAVIGATE_NEXT_SIBLING for level ${action.payload.levelNumber}. Setting request.`);
        nextState = {
          ...state,
          navigationRequest: {
            type: 'next',
            levelNumber: action.payload.levelNumber,
            expectedCurrentNodeId: action.payload.expectedCurrentNodeId
          }
        };
        break;
      }

    case ACTIONS.NAVIGATE_PREV_SIBLING:
      {
        console.log(`[Reducer] Received NAVIGATE_PREV_SIBLING for level ${action.payload.levelNumber}. Setting request.`);
        nextState = {
          ...state,
          navigationRequest: {
            type: 'prev',
            levelNumber: action.payload.levelNumber,
            expectedCurrentNodeId: action.payload.expectedCurrentNodeId
          }
        };
        break;
      }

    case ACTIONS.CLEAR_NAVIGATION_REQUEST:
      {
         console.log(`[Reducer] Clearing navigation request.`);
         nextState = {
            ...state,
            navigationRequest: null
         };
         break;
      }
    
    default:
      nextState = state;
  }
  return nextState;
}

interface PostTreeContextType {
  state: PostTreeState;
  dispatch: React.Dispatch<Action>;
}

const PostTreeContext = createContext<PostTreeContextType | undefined>(undefined);

export function PostTreeProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(postTreeReducer, initialState);
  const userContext = useUser();

  // Use useLayoutEffect to synchronously inject the store and user context before child effects run.
  useLayoutEffect(() => {
    postTreeOperator.setStore({ state, dispatch });
    postTreeOperator.setUserContext(userContext);
  }, [state, dispatch, userContext]);

  // Effect to handle navigation side effects
  useEffect(() => {
    const handleNavigation = async (request: NavigationRequest) => {
      console.log(`[Effect] Handling navigation request: ${request.type} for level ${request.levelNumber}`);
      try {
        if (request.type === 'next') {
          await postTreeOperator.handleNavigateNextSibling(
            request.levelNumber,
            request.expectedCurrentNodeId
          );
        } else if (request.type === 'prev') {
          await postTreeOperator.handleNavigatePrevSibling(
            request.levelNumber,
            request.expectedCurrentNodeId
          );
        }
      } catch (error) {
        console.error(`[Effect] Error during navigation (${request.type}) for level ${request.levelNumber}:`, error);
        // Optionally dispatch a general error action here if needed
        // dispatch({ type: ACTIONS.SET_ERROR, payload: `Navigation failed: ${error instanceof Error ? error.message : String(error)}` });
      } finally {
        // Always clear the request after attempting navigation
        console.log(`[Effect] Clearing navigation request after handling: ${request.type} for level ${request.levelNumber}`);
        dispatch({ type: ACTIONS.CLEAR_NAVIGATION_REQUEST });
      }
    };

    if (state.navigationRequest) {
      // Create a local copy of the request before the async operation
      const currentRequest = { ...state.navigationRequest }; 
      handleNavigation(currentRequest);
    }
    // Dependency array includes only the navigationRequest part of the state
  }, [state.navigationRequest, dispatch]);

  return (
    <PostTreeErrorBoundary>
      <PostTreeContext.Provider value={{ state, dispatch }}>
        {children}
      </PostTreeContext.Provider>
    </PostTreeErrorBoundary>
  );
}

export function usePostTree() {
  const context = useContext(PostTreeContext);
  if (!context) {
    throw new Error('usePostTree must be used within a PostTreeProvider');
  }
  return context;
} 