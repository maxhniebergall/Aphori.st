import { useCallback, useEffect, useState } from 'react';
import './Feed.css';
import { useNavigate } from 'react-router-dom';
import Header from './Header';
import { feedOperator } from '../operators/FeedOperator';
import { FeedItem, Pagination, FeedResponse, FetchResult } from '../types/types';
import { Virtuoso } from 'react-virtuoso';

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
    const apiResponse = await feedOperator.getFeedItems(cursor || "");

    if (!isFeedResponse(apiResponse)) { 
      throw new Error(`Invalid response format received from server. ${JSON.stringify(apiResponse)}`);
    }
    
    // If the type guard passed, apiResponse IS KNOWN to be of type FeedResponse.
    // apiResponse.pagination is therefore guaranteed to be defined by the isFeedResponse guard.

    return {
      data: apiResponse.data,
      pagination: {
        nextCursor: apiResponse.pagination!.nextCursor,   // Added non-null assertion
        prevCursor: apiResponse.pagination!.prevCursor,   // Added non-null assertion
        hasMore: apiResponse.pagination!.hasMore,         // Added non-null assertion
        totalCount: apiResponse.pagination!.totalCount    // Added non-null assertion
      }
    };
  }, []);

  // Load items when component mounts
  useEffect(() => {
    const loadItems = async () => {
      setError(null);
      try {
        const result = await fetchFeedItems();
        console.log("result", result);
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

  const navigateToPostTree = useCallback(
    (nodeId: string) => {
      navigate(`/postTree/${nodeId}`);
    },
    [navigate]
  );

  // Define the item rendering function for Virtuoso
  const renderItem = useCallback((index: number, item: FeedItem) => {
    return (
      <div
        key={item.id}
        onClick={() => {
          if(!item?.id) {
            console.warn("Encountered item with missing ID - navigation skipped");
          } else {
            navigateToPostTree(item.id);
          }
        }}
        className="feed-item"
      >
        <div className="feed-item-content">
          <p className="feed-text">
            {item.textSnippet ? truncateText(item.textSnippet) : 'Loading...'}
          </p>
        </div>
      </div>
    );
  }, [navigateToPostTree]);

  return (
    <>
      <Header 
        title=""
        subtitle=""
        onLogoClick={() => navigate('/feed')}
      />
      <div className="feed" style={{ height: 'calc(100vh - 60px)' }}>
        {error && <div className="feed-error-message">{error}</div>}
        
        <Virtuoso
          style={{ height: '100%' }}
          data={items}
          endReached={loadMoreItems}
          itemContent={renderItem}
          components={{
            Footer: () => {
              return pagination.hasMore ? (
                <div style={{ padding: '2rem', textAlign: 'center' }}>
                  Loading more...
                </div>
              ) : null;
            },
          }}
        />
      </div>
    </>
  );
}

export default Feed;
