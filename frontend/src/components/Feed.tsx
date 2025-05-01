import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import './Feed.css';
import { useNavigate } from 'react-router-dom';
import Header from './Header';
import { feedOperator } from '../operators/FeedOperator';
import { FeedItem, Pagination, FeedResponse, FetchResult } from '../types/types';

// Define regex patterns
const PATTERNS = {
  FORMATTING: /[*~_]{1,2}([^*~_]+)[*~_]{1,2}/g,
  LINKS: /\[([^\]]+)\]\([^)]+\)/g,
  CODE: /`([^`]+)`/g,
  HEADERS: /^#+\s+/gm,
  NEWLINES: /\n+/g,
  REMAINING: /[*~_`#[\]()]/g,
  SPACES: /\s+/g
};

// Helper function to strip markdown and truncate text
const truncateText = (text: string | undefined, maxLength = 150): string => {
  if (!text) return '';

  // Strip markdown characters and replace newlines with spaces
  let processedText = text
    // Remove bold/italic/strikethrough
    .replace(PATTERNS.FORMATTING, '$1')
    // Remove links
    .replace(PATTERNS.LINKS, '$1')
    // Remove code blocks
    .replace(PATTERNS.CODE, '$1')
    // Remove headers
    .replace(PATTERNS.HEADERS, '')
    // Replace newlines with spaces
    .replace(PATTERNS.NEWLINES, ' ')
    // Remove any remaining markdown characters
    .replace(PATTERNS.REMAINING, '')
    // Collapse multiple spaces
    .replace(PATTERNS.SPACES, ' ')
    .trim();
  
  if (processedText.length <= maxLength) return processedText;

  // Find the last complete word within maxLength
  let truncated = processedText.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > 0) {
    truncated = truncated.slice(0, lastSpace);
  }

  return truncated + '...';
};

function isFeedResponse(response: any): response is FeedResponse {
  return (
    response &&
    response.success === true &&
    Array.isArray(response.data) &&
    response.pagination &&
    (typeof response.pagination.nextCursor === 'string' || response.pagination.nextCursor === undefined) &&
    (typeof response.pagination.prevCursor === 'string' || response.pagination.prevCursor === undefined) &&
    typeof response.pagination.hasMore === 'boolean' &&
    typeof response.pagination.totalCount === 'number'
  );
}

function Feed(): JSX.Element {
  const navigate = useNavigate();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    nextCursor: undefined,
    prevCursor: undefined,
    hasMore: false,
    totalCount: 0
  });
  const [error, setError] = useState<string | null>(null);

  /**
   * Fetches feed items from the backend API.
   * @param {string} [cursor] - Optional cursor for pagination.
   * @returns {Promise<FetchResult>} The feed items and pagination info.
   * @throws {Error} If the API response format is invalid or indicates an error.
   *                 (Error is caught by calling useEffect/loadMoreItems and sets component error state).
   */
  const fetchFeedItems = useCallback(async (cursor?: string): Promise<FetchResult> => {
    const response = await feedOperator.getFeedItems(cursor || "");
    if (!isFeedResponse(response)) {
      // Handled: Caught by useEffect/loadMoreItems, sets error state.
      throw new Error('Invalid response format received from server.');
    }

    if (!response.success) {
      // Handled: Caught by useEffect/loadMoreItems, sets error state.
      throw new Error(response.error || 'Unknown error from server.');
    }
      
    if (!response.data || !Array.isArray(response.data)) {
      // Handled: Caught by useEffect/loadMoreItems, sets error state.
      throw new Error('Invalid data format received from server.');
    }

    return {
      data: response.data,
      pagination: {
        nextCursor: response.pagination.nextCursor,
        prevCursor: response.pagination.prevCursor,
        hasMore: response.pagination.hasMore,
        totalCount: response.pagination.totalCount
      }
    };
  }, []);

  // Load items when component mounts
  useEffect(() => {
    const loadItems = async () => {
      setError(null);
      try {
        const result = await fetchFeedItems();
        setItems(result.data);
        setPagination(result.pagination);
      } catch (error) {
        console.error("Failed to load initial feed items:", error);
        setError('Failed to load feed. Please try refreshing the page.');
      }
    };
    
    loadItems();
  }, [fetchFeedItems]);

  // Function to load more items
  const loadMoreItems = useCallback(async () => {
    if (!pagination.hasMore) return;
    
    setError(null);
    try {
      // Use empty string instead of undefined if nextCursor is not available
      const cursor = pagination.nextCursor || "";
      const result = await fetchFeedItems(cursor);
      // Append new items to existing ones
      setItems(prevItems => [...prevItems, ...result.data]);
      setPagination(result.pagination);
    } catch (error) {
      console.error("Failed to load more feed items:", error);
      setError('Failed to load more items. Please try again later.');
    }
  }, [fetchFeedItems, pagination.hasMore, pagination.nextCursor]);

  const navigateToStoryTree = useCallback(
    (nodeId: string) => {
      navigate(`/storyTree/${nodeId}`);
    },
    [navigate]
  );

  return (
    <>
      <Header 
        title=""
        subtitle=""
        onLogoClick={() => navigate('/feed')}
      />
      <div className="feed">
        {error && <div className="feed-error-message">{error}</div>}
        {items.map((item) => (
          <motion.div
            key={item.id}
            layoutId={item.id}
            onClick={() => {
              if(!item?.id) {
                console.warn("Encountered item with missing ID - navigation skipped");
              } else {
                navigateToStoryTree(item.id);
              }
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="feed-item"
          >
            {item.title && <motion.h3>{item.title}</motion.h3>}
            <motion.div className="feed-item-content">
              <p className="feed-text">
                {item.text ? truncateText(item.text) : 'Loading...'}
              </p>
            </motion.div>
          </motion.div>
        ))}
        
        {pagination.hasMore && (
          <button 
            className="load-more-button" 
            onClick={loadMoreItems}
          >
            Load More
          </button>
        )}
      </div>
    </>
  );
}

export default Feed;
