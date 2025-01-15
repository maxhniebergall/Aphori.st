/*
 * Requirements:
 * - Text selection utilities for handling word and range selection
 * - DOM manipulation for selection handling
 * - Word boundary detection
 * - Selection range calculations
 * - React event handling utilities
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
 * Calculates selection range from mouse/touch events
 * @param {Element} element - The DOM element containing the text
 * @param {Event} event - Mouse or touch event
 * @returns {{start: number, end: number}} Selection range positions
 */
export const getSelectionRange = (element, event) => {
  const { clientX, clientY } = event.touches ? event.touches[0] : event;
  const position = document.caretRangeFromPoint(clientX, clientY);
  
  if (!position) return null;
  
  return {
    start: position.startOffset,
    end: position.endOffset
  };
};

/**
 * Extracts selected text from an element
 * @param {Element} element - The DOM element
 * @param {number} start - Start offset
 * @param {number} end - End offset
 * @returns {string} Selected text
 */
export const getSelectedText = (element, start, end) => {
  const range = document.createRange();
  range.setStart(element.firstChild, start);
  range.setEnd(element.firstChild, end);
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