import { /* LastLevel, MidLevel, */ PostTreeLevel, PostTreeNode, Pagination, Siblings } from '../types/types';
import { Quote } from '../types/quote';
// import { Node } from "../types/node"; // Assuming Node is also from types/types or elsewhere?

/**
 * Helper functions to access properties from the new PostTreeLevel structure
 * These functions handle the new factorization of PostTreeLevel into MidLevel and LastLevel
 * They are pure functions without side effects.
 */

/**
 * Check if a level is a LastLevel
 */
export function isLastLevel(level: PostTreeLevel): boolean {
  if ('isLastLevel' in level) {
    return level.isLastLevel || (level.lastLevel !== null && level.midLevel === null);
  }
  return true; // If it's a LastLevel type directly
}

/**
 * Check if a level is a MidLevel
 */
export function isMidLevel(level: PostTreeLevel): boolean {
  if ('isLastLevel' in level) {
    return !level.isLastLevel && level.midLevel !== null;
  }
  return false; // If it's a LastLevel type directly
}

/**
 * Get the rootNodeId from a PostTreeLevel or LastLevel
 */
export function getRootNodeId(level: PostTreeLevel): string | undefined { 
  if (isLastLevel(level) && level.lastLevel) {
    return level.lastLevel.rootNodeId;
  } else if (isMidLevel(level) && level.midLevel) {
    return level.midLevel.rootNodeId;
  }
  return undefined;
}

/**
 * Get the levelNumber from a PostTreeLevel or LastLevel
 */
export function getLevelNumber(level: PostTreeLevel): number | undefined {
  if (isLastLevel(level) && level.lastLevel) {
    return level.lastLevel.levelNumber;
  } else if (isMidLevel(level) && level.midLevel) {
    return level.midLevel.levelNumber;
  }
  return undefined;
}

/**
 * Get the parentId from a PostTreeLevel
 */
export function getParentId(level: PostTreeLevel): string[] | undefined {
  if (isMidLevel(level) && level.midLevel) {
    return level.midLevel.parentId;
  }
  return undefined;
}

/**
 * Get the selectedQuoteInParent from a PostTreeLevel (the quote selected in the parent level)
 */
export function getSelectedQuoteInParent(level: PostTreeLevel): Quote | null {
  if (isMidLevel(level) && level.midLevel) {
    return level.midLevel.selectedQuoteInParent;
  }
  return null;
}

/**
 * Get the selectedQuoteInThisLevel from a PostTreeLevel (the quote selected within this level's node)
 */
export function getSelectedQuoteInThisLevel(level: PostTreeLevel): Quote | null {
  if (isMidLevel(level) && level.midLevel) {
    return level.midLevel.selectedQuoteInThisLevel;
  }
  return null;
}

/**
 * Set the selectedQuoteInThisLevel in a PostTreeLevel
 * 
 * Pure Function
 */
export function setSelectedQuoteInThisLevelHelper(level: PostTreeLevel, quote: Quote | null): PostTreeLevel {
  if (isMidLevel(level) && level.midLevel) {
    const newLevel = {
      ...level,
      midLevel: {
      ...level.midLevel,
      selectedQuoteInThisLevel: quote // Update this field
      }
    }
    return newLevel;
  } else {
    // Maybe log a warning or return level unchanged? Throwing might be too harsh.
    console.warn("Attempted to set selectedQuoteInThisLevel on a non-MidLevel or invalid level:", level);
    return level;
    // throw new Error("Invalid level"); 
  }
}

/**
 * Get the selectedNode from a PostTreeLevel
 */
export function getSelectedNodeHelper(level: PostTreeLevel): PostTreeNode | undefined {
  if (isMidLevel(level) && level.midLevel) {
    return level.midLevel.selectedNode;
  }
  return undefined;
}

/**
 * Set the selectedNode in a PostTreeLevel
 * Pure Function
 * (No side effects; does not dispatch)
 * Should be used to create a larger value which will be dispatched
 */
export function setSelectedNodeHelper(level: PostTreeLevel, node: PostTreeNode): PostTreeLevel {
  if (isMidLevel(level) && level.midLevel) {
    return {
      ...level,
      midLevel: {
        ...level.midLevel,
        selectedNode: node
      }
    };
  }
  return level;
}

/**
 * Get the siblings from a PostTreeLevel
 */
export function getSiblings(level: PostTreeLevel): Siblings | undefined {
  if (isMidLevel(level) && level.midLevel) {
    return level.midLevel.siblings;
  }
  return undefined;
}

/**
 * Get the pagination from a PostTreeLevel
 */
export function getPagination(level: PostTreeLevel): Pagination | undefined {
  if (isMidLevel(level) && level.midLevel) {
    return level.midLevel.pagination;
  }
  return undefined;
}

/**
 * Create a MidLevel PostTreeLevel

 * Pure Function
 * (No side effects; does not dispatch)
 * Should be used to create a larger value which will be dispatched
 */
export function createMidLevel(
  rootNodeId: string,
  parentId: string[],
  levelNumber: number,
  selectedQuoteInParent: Quote | null,
  selectedQuoteInThisLevel: Quote | null,
  selectedNode: PostTreeNode,
  siblings: Siblings,
  pagination: Pagination
): PostTreeLevel {
  return {
    isLastLevel: false,
    midLevel: {
      rootNodeId,
      parentId,
      levelNumber,
      selectedQuoteInParent,
      selectedQuoteInThisLevel,
      selectedNode,
      siblings,
      pagination
    },
    lastLevel: null
  };
}

/**
 * Create a LastLevel PostTreeLevel
 * Pure Function
 * (No side effects; does not dispatch)
 * Should be used to create a larger value which will be dispatched
 */
export function createLastLevel(
  rootNodeId: string,
  levelNumber: number
): PostTreeLevel {
  return {
    isLastLevel: true,
    midLevel: null,
    lastLevel: {
      rootNodeId,
      levelNumber
    }
  };
}

// Helper function to update siblings for a quote in the array-based structure
// Now returns original siblings reference if nodes for the quote are unchanged.
export function updateSiblingsForQuoteHelper(siblings: Siblings, quote: Quote | null, nodes: PostTreeNode[]): Siblings {
  const index = siblings.levelsMap.findIndex(([key]) => {
    if (key === null && quote === null) {
      return true;
    }
    if (!key || !quote) {
      return false;
    }
    // Using stricter quote comparison
    return key.sourceId === quote.sourceId &&
           key.text === quote.text &&
           key.selectionRange.start === quote.selectionRange.start &&
           key.selectionRange.end === quote.selectionRange.end;
  });

  const existingNodes = index >= 0 ? siblings.levelsMap[index][1] : [];

  // Compare current nodes with new nodes based on ID sequence
  const existingNodeIds = existingNodes.map(n => n.id);
  const newNodeIds = nodes.map(n => n.id);

  let areNodeListsIdentical = existingNodeIds.length === newNodeIds.length;
  if (areNodeListsIdentical) {
    for (let i = 0; i < existingNodeIds.length; i++) {
      if (existingNodeIds[i] !== newNodeIds[i]) {
        areNodeListsIdentical = false;
        break;
      }
    }
  }

  // If the list of nodes for this quote is identical, return the original siblings object
  if (areNodeListsIdentical && index >= 0) { // Ensure it's not a new quote addition
    return siblings;
  }

  // Otherwise, create a new levelsMap and return a new Siblings object
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
 