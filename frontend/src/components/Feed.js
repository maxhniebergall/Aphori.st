// components/Feed.js
import React, { useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import './Feed.css';
import { useNavigate } from 'react-router-dom';
import Header from './Header';
import { usePagination } from '../utils/pagination';
import feedOperator from '../operators/FeedOperator';

// Helper function to strip markdown and truncate text
const truncateText = (text, maxLength = 150) => {
  if (!text) return text;

  // Strip markdown characters and replace newlines with spaces
  let processedText = text
    // Remove bold/italic/strikethrough
    .replace(/[*~_]{1,2}([^*~_]+)[*~_]{1,2}/g, '$1')
    // Remove links
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove code blocks
    .replace(/`([^`]+)`/g, '$1')
    // Remove headers
    .replace(/^#+\s+/gm, '')
    // Replace newlines with spaces
    .replace(/\n+/g, ' ')
    // Remove any remaining markdown characters
    .replace(/[*~_`#[\]()]/g, '')
    // Collapse multiple spaces
    .replace(/\s+/g, ' ')
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

function Feed() {
  const navigate = useNavigate();

  // Create a paginated fetcher for feed items
  const fetchFeedItems = async (cursor, limit) => {
    try {
      const response = await feedOperator.getFeedItems(cursor);
      if (!response.success) {
        throw new Error(response.error);
      }
      
      // Validate response data
      if (!response.items || !Array.isArray(response.items)) {
        throw new Error('Invalid response format');
      }

      return {
        data: response.items,
        pagination: {
          nextCursor: response.pagination?.nextCursor,
          prevCursor: response.pagination?.prevCursor,
          hasMore: response.pagination?.hasMore || false,
          matchingItemsCount: response.pagination?.matchingItemsCount || response.items.length
        }
      };
    } catch (error) {
      console.error('Error in fetchFeedItems:', error);
      throw error;
    }
  };

  // Use the usePagination hook
  const {
    items,
    isLoading,
    error,
    loadMore,
    reset,
    hasMore
  } = usePagination(fetchFeedItems, {
    limit: 10
  });

  // Load items when component mounts
  useEffect(() => {
    loadMore();
  }, [loadMore]);

  const navigateToStoryTree = useCallback(
    (nodeId) => {
      navigate(`/storyTree/${nodeId}`);
    },
    [navigate]
  );

  console.log('Feed: Current state:', { isLoading, error, itemsCount: items.length, hasMore });

  if (isLoading && items.length === 0) {
    return (
      <>
        <Header 
          title=""
          onLogoClick={() => navigate('/feed')}
        />
        <div>Loading...</div>
      </>
    );
  }

  return (
    <>
      <Header 
        title=""
        onLogoClick={() => navigate('/feed')}
      />
      <div className="feed">
        {items.map((item) => (
          <motion.div
            key={item.id}
            layoutId={item.id}
            onClick={() => {
              if(!item?.id) {
                console.log("placeholder item, skipping");
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
        {hasMore && (
          <button 
            onClick={() => loadMore()}
            disabled={isLoading}
          >
            {isLoading ? 'Loading more...' : 'Load more'}
          </button>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
      </div>
    </>
  );
}

export default Feed;
