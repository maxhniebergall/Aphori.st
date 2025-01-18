/*
 * Requirements:
 * - Word boundary detection for click selection
 * - Range selection calculations for drag selection
 * - DOM text node traversal and manipulation
 * - Selection offset calculations and validation
 * - Text extraction from selection ranges
 * - Cross-browser event handling support
 * - Touch and mouse event coordinate handling
 * - Selection range validation and sanitization
 */

/**
 * Gets the word boundaries for a clicked position in text
 * @param {string} text - The full text content
 * @param {number} position - The clicked position
 * @returns {{start: number, end: number}} Word boundary positions
 */
export const getWordBoundaries = (text, position) => {
  let start = position;
  let end = position;

  // Move start to the beginning of the word
  while (start > 0 && /\w/.test(text[start - 1])) {
    start--;
  }

  // Move end to the end of the word
  while (end < text.length && /\w/.test(text[end])) {
    end++;
  }

  return { start, end };
};

/**
 * Finds the text node and offset at a specific point
 * @param {Element} element - The container element
 * @param {number} x - Client X coordinate
 * @param {number} y - Client Y coordinate
 * @returns {{node: Node, offset: number} | null}
 */
export const findNodeTextFromEvent = (element, event) => {

  const x = event.type === 'touchstart' ? event.touches[0].clientX : event.clientX;
  const y = event.type === 'touchstart' ? event.touches[0].clientY : event.clientY;

  // Validate coordinates
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  // Get element bounds to validate click is within element
  const rect = element.getBoundingClientRect();
  if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
    return null;
  }

  // Try modern API first
  if (document.caretPositionFromPoint) {
    try {
      const position = document.caretPositionFromPoint(x, y);
      if (position && position.offsetNode.nodeType === Node.TEXT_NODE) {
        return {
          node: position.offsetNode,
          offset: position.offset
        };
      }
    } catch (e) {
      // Fall through to next method if this fails
    }
  }

  // Fallback to range API
  try {
    const range = document.caretRangeFromPoint(x, y);
    if (range && range.startContainer.nodeType === Node.TEXT_NODE) {
      return {
        node: range.startContainer,
        offset: range.startOffset
      };
    }
  } catch (e) {
    // Fall through to return null if all methods fail
  }
  
  return null;
};

/**
 * Gets the cumulative offset for a text node within its container
 * @param {Node} textNode - The text node
 * @param {Element} container - The container element
 * @returns {number} The cumulative offset
 */
const getCumulativeOffset = (textNode, container) => {
  let offset = 0;
  const walk = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  
  while (walk.nextNode()) {
    if (walk.currentNode === textNode) {
      return offset;
    }
    offset += walk.currentNode.textContent.length;
  }
  return offset;
};

/**
 * Calculates selection range from mouse/touch events
 * @param {Element} element - The DOM element containing the text
 * @param {Event} event - Mouse or touch event
 * @returns {number | null} Current offset
 */
export const getCurrentOffset = (element, event) => {
    if (!element || !event) return null;
    const result = findNodeTextFromEvent(element, event);

    if (!result) return null;

    const { node, offset } = result;
    const currentOffset = getCumulativeOffset(node, element) + offset;

    return currentOffset;
};

/**
 * Finds a text node and offset from a cumulative position
 * @param {Element} element - The container element
 * @param {number} position - The cumulative position
 * @returns {{node: Node, offset: number} | null}
 */
const findNodeAndOffsetFromPosition = (element, position) => {
  let currentOffset = 0;
  const walk = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  
  while (walk.nextNode()) {
    const node = walk.currentNode;
    const length = node.textContent.length;
    
    if (currentOffset + length > position) {
      return {
        node,
        offset: position - currentOffset
      };
    }
    currentOffset += length;
  }
  return null;
};

/**
 * Extracts selected text from an element
 * @param {Element} element - The DOM element
 * @param {number} start - Start offset
 * @param {number} end - End offset
 * @returns {string} Selected text
 */
export const getSelectedText = (element, start, end) => {
  const startPos = findNodeAndOffsetFromPosition(element, start);
  const endPos = findNodeAndOffsetFromPosition(element, end);
  
  if (!startPos || !endPos) return '';
  
  const range = document.createRange();
  range.setStart(startPos.node, startPos.offset);
  range.setEnd(endPos.node, endPos.offset);
  return range.toString();
};

/**
 * Validates if a selection range is valid
 * @param {number} start - Start offset
 * @param {number} end - End offset
 * @param {number} textLength - Total text length
 * @returns {boolean} Whether the selection is valid
 */
export const isValidSelection = (start, end, textLength) => {
  return (
    start >= 0 &&
    end <= textLength &&
    end > start &&
    Number.isInteger(start) &&
    Number.isInteger(end)
  );
};

/**
 * Checks if coordinates are within container bounds
 * @param {Element} container - The container element
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @returns {boolean} Whether coordinates are within bounds
 */
export const isWithinContainerBounds = (container, event) => {
    const x = event.type === 'touchstart' ? event.touches[0].clientX : event.clientX;
    const y = event.type === 'touchstart' ? event.touches[0].clientY : event.clientY;
    const containerRect = container.getBoundingClientRect();
    return (
        x >= containerRect.left &&
        x <= containerRect.right &&
        y >= containerRect.top &&
        y <= containerRect.bottom
    );
}; 