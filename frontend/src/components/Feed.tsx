// components/Feed.js
import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import './Feed.css';
import { useNavigate } from 'react-router-dom';
import Header from './Header';
import feedOperator from '../operators/FeedOperator';
import { FeedItem, Pagination, FeedResponse, FetchResult } from '../types/types';

// Helper function to strip markdown and truncate text
const truncateText = (text: string | undefined, maxLength = 150): string => {
  if (!text) return '';

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

function Feed(): JSX.Element {
  const navigate = useNavigate();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    nextCursor: undefined,
    prevCursor: undefined,
    hasMore: false,
    matchingRepliesCount: 0
  });

  const fetchFeedItems = useCallback(async (cursor?: string): Promise<FetchResult> => {
    try {
      // Make sure cursor is a string when passed to the API
      const response = await feedOperator.getFeedItems(cursor || "") as FeedResponse;
      
      if (!response.success) {
        throw new Error(response.error || 'Unknown error');
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
          matchingRepliesCount: response.pagination?.matchingRepliesCount || response.items.length
        }
      };
    } catch (error) {
      console.error('Error in fetchFeedItems:', error);
      throw error;
    }
  }, []);

  // Load items when component mounts
  useEffect(() => {
    const loadItems = async () => {
      try {
        const result = await fetchFeedItems();
        setItems(result.data);
        setPagination(result.pagination);
      } catch (error) {
        console.error('Failed to load feed items:', error);
      }
    };
    
    loadItems();
  }, [fetchFeedItems]);

  // Function to load more items
  const loadMoreItems = useCallback(async () => {
    if (!pagination.hasMore) return;
    
    try {
      // Use empty string instead of undefined if nextCursor is not available
      const cursor = pagination.nextCursor || "";
      const result = await fetchFeedItems(cursor);
      // Append new items to existing ones
      setItems(prevItems => [...prevItems, ...result.data]);
      setPagination(result.pagination);
    } catch (error) {
      console.error('Failed to load more items:', error);
    }
  }, [fetchFeedItems, pagination.hasMore, pagination.nextCursor]);

  const navigateToStoryTree = useCallback(
    (nodeId: string) => {
      navigate(`/storyTree/${nodeId}`);
    },
    [navigate]
  );

  console.log('Feed: Current state:', {
    itemsCount: items.length,
    pagination
  });

  return (
    <>
      <Header 
        title=""
        subtitle=""
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
