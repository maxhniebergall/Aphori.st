import { Quote } from '../types/quote';

const STORAGE_PREFIX = 'replyDraft-';
const EXPIRATION_MS = 48 * 60 * 60 * 1000; // 48 hours

interface StoredReply {
  content: string;
  quote: Quote;
  timestamp: number;
}

// Basic hash function for the quote text to keep keys manageable
// Avoids issues with very long quotes or special characters in keys.
// Simple djb2 hash implementation.
function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) + hash) + char; /* hash * 33 + c */
  }
  return hash;
}


/**
 * Generates a unique key for storing reply drafts.
 * Uses root UUID, parent ID, and quote details (hash, start, end).
 */
export function generateReplyKey(rootUUID: string, parentId: string, quote: Quote | null): string | null {
    // Require quote text and selection range for a unique key
    if (!rootUUID || !parentId || !quote?.text || !quote.selectionRange) { 
        return null;
    }
    // Use precise quote details for the key
    const quoteIdentifier = `${hashString(quote.text)}-${quote.selectionRange.start}-${quote.selectionRange.end}`;
    return `${STORAGE_PREFIX}${rootUUID}-${parentId}-${quoteIdentifier}`;
}

/**
 * Saves reply content, quote, and timestamp to localStorage.
 */
export function saveReplyContent(key: string, content: string, quote: Quote): void {
  if (!key) return;
  try {
    // Ensure quote is provided before saving
    if (!quote) {
        console.warn("Attempted to save reply draft without a quote.");
        return;
    }
    if (!content || content.length === 0 || content.trim() === '') {
      localStorage.removeItem(key);
        return;
    }
    const data: StoredReply = { content, quote, timestamp: Date.now() };
    localStorage.setItem(key, JSON.stringify(data));
  } catch (error) {
    console.error("Error saving reply draft to localStorage:", error);
    // Handle potential storage quota exceeded errors
  }
}

/**
 * Loads a specific reply draft (content, quote, timestamp) from localStorage.
 * Returns the StoredReply object or null if not found or expired.
 */
export function loadReplyContent(key: string): StoredReply | null {
  if (!key) return null;
  try {
    const item = localStorage.getItem(key);
    if (!item) return null;

    const data: StoredReply = JSON.parse(item);
    
    // Validate essential fields after parsing
    if (!data || typeof data.content !== 'string' || !data.quote || typeof data.timestamp !== 'number') {
        console.error("Invalid stored reply format found for key:", key);
        removeReplyContent(key); // Remove corrupted item
        return null;
    }

    if (Date.now() - data.timestamp > EXPIRATION_MS) {
      // Expired, remove it
      removeReplyContent(key);
      return null;
    }
    return data; // Return the full object
  } catch (error) {
    console.error("Error loading reply draft from localStorage:", error);
    if (key) {
        try {
            localStorage.removeItem(key); // Clean up corrupted/unparseable item
        } catch (removeError) {
            console.error("Failed to remove corrupted item from localStorage:", removeError);
        }
    }
    return null;
  }
}

/**
 * Finds the most recent, non-expired reply draft associated with a specific root and parent node.
 * Returns the full StoredReply object or null if none found.
 */
export function findLatestDraftForParent(rootUUID: string, parentId: string): StoredReply | null {
  if (!rootUUID || !parentId) return null;

  let latestDraft: StoredReply | null = null;
  const searchPrefix = `${STORAGE_PREFIX}${rootUUID}-${parentId}-`;

  try {
    // Iterate safely through localStorage keys
    const keys = Object.keys(localStorage);
    for (const key of keys) {
      if (key.startsWith(searchPrefix)) {
        const draft = loadReplyContent(key); // Use loadReplyContent for parsing and expiration check
        if (draft) {
          // Check if this draft is more recent than the current latest
          if (!latestDraft || draft.timestamp > latestDraft.timestamp) {
            latestDraft = draft;
          }
        }
      }
    }
  } catch (error) {
    console.error("Error searching for latest reply draft:", error);
  }

  return latestDraft;
}

/**
 * Removes a specific reply draft from localStorage.
 */
export function removeReplyContent(key: string): void {
  if (!key) return;
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.error("Error removing reply draft from localStorage:", error);
  }
}

/**
 * Cleans up expired reply drafts from localStorage.
 * Should be called periodically, e.g., on app load.
 * REMINDER: Call this function once when the main application component mounts.
 */
export function cleanupExpiredReplies(): void {
  try {
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith(STORAGE_PREFIX)) {
        const item = localStorage.getItem(key);
        if (item) {
          try {
            const data: StoredReply = JSON.parse(item);
            if (Date.now() - data.timestamp > EXPIRATION_MS) {
              localStorage.removeItem(key);
              // console.log(`Removed expired reply draft: ${key}`); // Optional logging
            }
          } catch (parseError) {
            // Corrupted item, remove it
            console.error(`Error parsing stored reply draft for key ${key}, removing.`, parseError);
            localStorage.removeItem(key);
          }
        }
      }
    });
  } catch (error) {
    console.error("Error during cleanup of expired reply drafts:", error);
  }
} 