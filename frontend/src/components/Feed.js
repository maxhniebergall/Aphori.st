// components/Feed.js
import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import './Feed.css';
import { useNavigate } from 'react-router-dom';
import Header from './Header';
import feedOperator from '../operators/FeedOperator';
import Markdown from 'react-markdown'

function Feed() {
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(1);
  const navigate = useNavigate();

  const navigateToStoryTree = useCallback(
    (nodeId) => {
      navigate(`/storyTree/${nodeId}`);
    },
    [navigate]
  );

  useEffect(() => {
    console.log('Feed: Starting to fetch items');
    const fetchFeedItems = async () => {
      console.log('Feed: Setting loading state to true');
      setIsLoading(true);
      try {
        console.log('Feed: Making API request');
        const result = await feedOperator.getFeedItems(currentIndex);
        console.log('Feed: Received response:', result);

        if (result?.success && result?.items) {
          console.log('Feed: Setting items:', result.items);
          const processedItems = result.items.map((item, index) => ({
            ...item,
            id: item.id
          }));
          setItems(processedItems);
        } else {
          console.log('Feed: No items in response or error, setting empty array');
          setItems([]);
          if (!result.success) {
            setError(result.error);
          }
        }
      } catch (error) {
        console.error('Feed: Error fetching feed items:', error);
        setError('Failed to load feed items');
        setItems([]);
      } finally {
        console.log('Feed: Setting loading state to false');
        setIsLoading(false);
      }
    };

    fetchFeedItems();
  }, [currentIndex]);

  console.log('Feed: Current state:', { isLoading, error, itemsCount: items.length });

  if (isLoading) {
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

  if (error) {
    return (
      <>
        <Header 
          title=""
          onLogoClick={() => navigate('/feed')}
        />
        <div>Error: {error}</div>
      </>
    );
  }

  return (
    <>
      <Header 
          title=""
          onLogoClick={() => navigate('/feed')}
      />
      <div className="feed-container">
        {items && items.length > 0 ? (
          items.map((item, index) => {
            const itemKey = item.id || "placeholder-"+index;
            return (
              <motion.div
                key={itemKey}
                layoutId={itemKey}
                onClick={() => {
                  if(!item?.id) {
                    console.log("placeholder item, skipping");
                    // placeholders are just for loading state, so we don't want to navigate to them
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
                <motion.p>
                <Markdown components={{
                  a: ({ node, children, ...props }) => (  // Add children parameter
                    <a target="_blank" rel="noopener noreferrer" {...props}>
                      {children} 
                    </a>
                  ),
                }}>
                  {item.text 
                    ? (item.text.length > 80 
                        ? item.text.substring(0, 75) + ". . ."
                        : item.text)
                    : 'Loading... '}
                  </Markdown>
                </motion.p>
              </motion.div>
            );
          })
        ) : (
          <div>No items to display</div>
        )}
      </div>
    </>
  );
}

export default Feed;
