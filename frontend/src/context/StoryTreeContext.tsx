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
};

function getIndexOfNewLevelInExistingLevels(existingLevels: Array<StoryTreeLevel | LastLevel>, level: StoryTreeLevel | LastLevel): number {
  return existingLevels.findIndex(existingLevel => 
    getRootNodeId(existingLevel) === getRootNodeId(level) && 
    getLevelNumber(existingLevel) === getLevelNumber(level)
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

function mergeLevel(existingLevel: StoryTreeLevel, newLevel: StoryTreeLevel): StoryTreeLevel {
  // Existing nodes with the same ID as the new nodes are replaced with the new nodes
  // Other existing nodes are left unchanged
  // Other new nodes are added to the level
  // The siblings are updated to include the new nodes
  // The level is returned

  if (!isMidLevel(existingLevel) || !isMidLevel(newLevel)) {
    throw new Error("Both levels must be MidLevel to merge");
  }

  if (!existingLevel.midLevel || !newLevel.midLevel) {
    throw new Error("MidLevel is not defined");
  }

  const existingNodes = existingLevel.midLevel.siblings.levelsMap.flatMap(([_, nodes]) => nodes);
  const newNodes = newLevel.midLevel.siblings.levelsMap.flatMap(([_, nodes]) => nodes);

  const mergedNodes = [...existingNodes];

  for (const newNode of newNodes) {
    const existingNodeIndex = mergedNodes.findIndex(node => node.id === newNode.id);
    if (existingNodeIndex >= 0) {
      mergedNodes[existingNodeIndex] = newNode;
    } else {
      mergedNodes.push(newNode);
    }
  }

  const updatedSiblings = updateSiblingsForQuoteHelper(
    existingLevel.midLevel.siblings,
    newLevel.midLevel.selectedQuote,
    mergedNodes
  );

  return {
    ...existingLevel,
    midLevel: {
      ...existingLevel.midLevel,
      siblings: updatedSiblings
    }
  };
}

export function mergeLevels(existingLevels: Array<StoryTreeLevel>, newLevels: Array<StoryTreeLevel>): Array<StoryTreeLevel> {
  const returnableLevels = [...existingLevels];

  for (const levelWithNewItems of newLevels) {
    const levelIndex = getIndexOfNewLevelInExistingLevels(existingLevels, levelWithNewItems);
    
    if (levelIndex === -1) {
      // indicates a new level
      returnableLevels.push(levelWithNewItems);
    } else if (levelWithNewItems.isLastLevel) {
      throw new Error("attempting to replace an existing level with a LastLevel[" + getLevelNumber(levelWithNewItems) + "]"  + JSON.stringify({levelWithNewItems, returnableLevels, levelIndex}));
    } else {
      // Merge the existing level with the new level
      // Existing nodes with the same ID as the new nodes are replaced with the new nodes
      
      // Create a new level with updated pagination
      const updatedLevel = mergeLevel(returnableLevels[levelIndex], levelWithNewItems);

      returnableLevels[levelIndex] = updatedLevel;

      // Merge siblings map using cursor based pagination.
      // Instead of using an index for insertion, check for the existence of prevCursor:
      // if prevCursor exists, the new nodes are from an earlier page and should be prepended;
      // otherwise, they are appended.
      const newSiblings = getSiblings(levelWithNewItems);
      if (newSiblings?.levelsMap) {
        for (const [quote, newNodesAtLevel] of newSiblings.levelsMap) {
          const existingSiblings = findSiblingsForQuote(getSiblings(updatedLevel)!, quote);
          
          // Filter out nodes that already exist
          const existingIds = existingSiblings ? new Set(existingSiblings.map((node: StoryTreeNode) => node.id)) : new Set();
          const uniqueNewNodes = newNodesAtLevel.filter((node: StoryTreeNode) => !existingIds.has(node.id));
          
          if (existingSiblings && existingSiblings.length > 0) {
            const pagination = getPagination(levelWithNewItems);
            if (pagination?.prevCursor) {
              // Prepend new nodes if pagination indicates loading a previous page.
              const updatedSiblings = updateSiblingsForQuoteHelper(
                getSiblings(updatedLevel)!,
                quote,
                [...uniqueNewNodes, ...existingSiblings]
              );
              
              // Update the level with the new siblings
              returnableLevels[levelIndex] = {
                ...updatedLevel,
                midLevel: {
                  ...updatedLevel.midLevel!,
                  siblings: updatedSiblings
                }
              };
            } else {
              // Otherwise, append new nodes.
              const updatedSiblings = updateSiblingsForQuoteHelper(
                getSiblings(updatedLevel)!,
                quote,
                [...existingSiblings, ...uniqueNewNodes]
              );
              
              // Update the level with the new siblings
              returnableLevels[levelIndex] = {
                ...updatedLevel,
                midLevel: {
                  ...updatedLevel.midLevel!,
                  siblings: updatedSiblings
                }
              };
            }
          } else {
            const updatedSiblings = updateSiblingsForQuoteHelper(
              getSiblings(updatedLevel)!,
              quote,
              uniqueNewNodes
            );
            
            // Update the level with the new siblings
            returnableLevels[levelIndex] = {
              ...updatedLevel,
              midLevel: {
                ...updatedLevel.midLevel!,
                siblings: updatedSiblings
              }
            };
          }
        }
      }
    }
  }

  return returnableLevels;
}

function storyTreeReducer(state: StoryTreeState, action: Action): StoryTreeState {
  let nextState: StoryTreeState = state;
  switch (action.type) {
    case ACTIONS.START_STORY_TREE_LOAD:
      {
        nextState = {
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
        break;
      }
    
    case ACTIONS.SET_INITIAL_STORY_TREE_DATA:
    {
      nextState = {
        ...state,
        storyTree: action.payload.storyTree,
      };
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
          console.error("StoryTree is not initialized");
          return state;
        }

        const selectedNode: StoryTreeNode = action.payload;
        const updatedLevel = state.storyTree.levels.find(level => 
          getLevelNumber(level) === selectedNode.levelNumber
        );

        if (!updatedLevel) {
          console.error("Selected level not found");
          return state; // or handle the error as needed
        }

        // Create a new levels array
        const newLevels = [...state.storyTree.levels];
        
        // Update the level with the selected node using the helper function
        newLevels[selectedNode.levelNumber] = setSelectedNodeHelper(updatedLevel as StoryTreeLevel, selectedNode);
        
        // Truncate levels after the selected level if needed
        if (selectedNode.levelNumber < newLevels.length - 1) {
          newLevels.length = selectedNode.levelNumber + 1;
        }
        
        nextState = {
          ...state,
          storyTree: { ...state.storyTree, levels: newLevels }
        };
        break;
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
        const lastLevel : StoryTreeLevel = createLastLevel(state.storyTree.post.id, lastLevelNumberInPayload);
        const newLevels : Array<StoryTreeLevel> = [...state.storyTree.levels, lastLevel];
        nextState = {
          ...state,
          storyTree: { ...state.storyTree, levels: newLevels }
        };
        break;
      }
    
    case ACTIONS.SET_ERROR:
      {
        let error: string | null = null;
        if (typeof action.payload === 'string') {
          error = action.payload;
        }
        nextState = {
          ...state,
          error: error
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