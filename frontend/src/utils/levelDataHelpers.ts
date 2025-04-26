import { LastLevel, MidLevel, StoryTreeLevel, StoryTreeNode, Pagination, Siblings } from '../types/types';
import { Quote } from '../types/quote';

/**
 * Helper functions to access properties from the new StoryTreeLevel structure
 * These functions handle the new factorization of StoryTreeLevel into MidLevel and LastLevel
 * They are pure functions without side effects.
 */

/**
 * Check if a level is a LastLevel
 */
export function isLastLevel(level: StoryTreeLevel): boolean {
  if ('isLastLevel' in level) {
    return level.isLastLevel || (level.lastLevel !== null && level.midLevel === null);
  }
  return true; // If it's a LastLevel type directly
}

/**
 * Check if a level is a MidLevel
 */
export function isMidLevel(level: StoryTreeLevel): boolean {
  if ('isLastLevel' in level) {
    return !level.isLastLevel && level.midLevel !== null;
  }
  return false; // If it's a LastLevel type directly
}

/**
 * Get the rootNodeId from a StoryTreeLevel or LastLevel
 */
export function getRootNodeId(level: StoryTreeLevel): string | undefined { 
  if (isLastLevel(level) && level.lastLevel) {
    return level.lastLevel.rootNodeId;
  } else if (isMidLevel(level) && level.midLevel) {
    return level.midLevel.rootNodeId;
  }
  return undefined;
}

/**
 * Get the levelNumber from a StoryTreeLevel or LastLevel
 */
export function getLevelNumber(level: StoryTreeLevel): number | undefined {
  if (isLastLevel(level) && level.lastLevel) {
    return level.lastLevel.levelNumber;
  } else if (isMidLevel(level) && level.midLevel) {
    return level.midLevel.levelNumber;
  }
  return undefined;
}

/**
 * Get the parentId from a StoryTreeLevel
 */
export function getParentId(level: StoryTreeLevel): string[] | undefined {
  if (isMidLevel(level) && level.midLevel) {
    return level.midLevel.parentId;
  }
  return undefined;
}

/**
 * Get the selectedQuote from a StoryTreeLevel
 */
export function getSelectedQuote(level: StoryTreeLevel): Quote | undefined {
  if (isMidLevel(level) && level.midLevel) {
    return level.midLevel.selectedQuote;
  }
  return undefined;
}

/**
 * Set the selectedQuote in a StoryTreeLevel
  
 * Pure Function
 */
export function setSelectedQuoteHelper(level: StoryTreeLevel, quote: Quote): StoryTreeLevel {
  if (isMidLevel(level) && level.midLevel) {
    const newLevel = {
      ...level,
      midLevel: {
      ...level.midLevel,
      selectedQuote: quote
      }
    }
    return newLevel;
  } else {
    throw new Error("Invalid level");
  }
}

/**
 * Get the selectedNode from a StoryTreeLevel
 */
export function getSelectedNodeHelper(level: StoryTreeLevel): StoryTreeNode | undefined {
  if (isMidLevel(level) && level.midLevel) {
    return level.midLevel.selectedNode;
  }
  return undefined;
}

/**
 * Set the selectedNode in a StoryTreeLevel
 * Pure Function
 * (No side effects; does not dispatch)
 * Should be used to create a larger value which will be dispatched
 */
export function setSelectedNodeHelper(level: StoryTreeLevel, node: StoryTreeNode): StoryTreeLevel {
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
 * Get the siblings from a StoryTreeLevel
 */
export function getSiblings(level: StoryTreeLevel): Siblings | undefined {
  if (isMidLevel(level) && level.midLevel) {
    return level.midLevel.siblings;
  }
  return undefined;
}

/**
 * Get the pagination from a StoryTreeLevel
 */
export function getPagination(level: StoryTreeLevel): Pagination | undefined {
  if (isMidLevel(level) && level.midLevel) {
    return level.midLevel.pagination;
  }
  return undefined;
}

/**
 * Create a MidLevel StoryTreeLevel

 * Pure Function
 * (No side effects; does not dispatch)
 * Should be used to create a larger value which will be dispatched
 */
export function createMidLevel(
  rootNodeId: string,
  parentId: string[],
  levelNumber: number,
  selectedQuote: Quote,
  selectedNode: StoryTreeNode,
  siblings: Siblings,
  pagination: Pagination
): StoryTreeLevel {
  return {
    isLastLevel: false,
    midLevel: {
      rootNodeId,
      parentId,
      levelNumber,
      selectedQuote,
      selectedNode,
      siblings,
      pagination
    },
    lastLevel: null
  };
}

/**
 * Create a LastLevel StoryTreeLevel
 * Pure Function
 * (No side effects; does not dispatch)
 * Should be used to create a larger value which will be dispatched
 */
export function createLastLevel(
  rootNodeId: string,
  levelNumber: number
): StoryTreeLevel {
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
export function updateSiblingsForQuoteHelper(siblings: Siblings, quote: Quote | null, nodes: StoryTreeNode[]): Siblings {
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
 