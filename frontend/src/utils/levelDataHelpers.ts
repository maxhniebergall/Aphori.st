import { LastLevel, MidLevel, StoryTreeLevel, StoryTreeNode, Pagination, Siblings } from '../types/types';
import { Quote } from '../types/quote';

/**
 * Helper functions to access properties from the new StoryTreeLevel structure
 * These functions handle the new factorization of StoryTreeLevel into MidLevel and LastLevel
 */

/**
 * Check if a level is a LastLevel
 */
export function isLastLevel(level: StoryTreeLevel | LastLevel): boolean {
  if ('isLastLevel' in level) {
    return level.isLastLevel || (level.lastLevel !== null && level.midLevel === null);
  }
  return true; // If it's a LastLevel type directly
}

/**
 * Check if a level is a MidLevel
 */
export function isMidLevel(level: StoryTreeLevel | LastLevel): boolean {
  if ('isLastLevel' in level) {
    return !level.isLastLevel && level.midLevel !== null;
  }
  return false; // If it's a LastLevel type directly
}

/**
 * Get the rootNodeId from a StoryTreeLevel or LastLevel
 */
export function getRootNodeId(level: StoryTreeLevel | LastLevel): string | undefined {
  if ('rootNodeId' in level) {
    return level.rootNodeId; // Direct access for LastLevel
  }
  
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
export function getLevelNumber(level: StoryTreeLevel | LastLevel): number | undefined {
  if ('levelNumber' in level) {
    return level.levelNumber; // Direct access for LastLevel
  }
  
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
 * Get the selectedNode from a StoryTreeLevel
 */
export function getSelectedNode(level: StoryTreeLevel): StoryTreeNode | undefined {
  if (isMidLevel(level) && level.midLevel) {
    return level.midLevel.selectedNode;
  }
  return undefined;
}

/**
 * Pure Function
 * Set the selectedNode in a StoryTreeLevel
 */
export function setSelectedNode(level: StoryTreeLevel, node: StoryTreeNode): StoryTreeLevel {
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