// components/Feed.js
import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import './Feed.css';
import { useNavigate } from 'react-router-dom';
import Header from './Header';
import feedOperator from '../operators/FeedOperator';

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

        if (result.success && result.data?.items) {
          console.log('Feed: Setting items:', result.data.items);
          const processedItems = result.data.items.map((item, index) => ({
            ...item,
            id: item.id || `feed-item-${index}`
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
    console.log('Feed: Rendering loading state');
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
    console.log('Feed: Rendering error state');
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

  console.log('Feed: Rendering items');
  return (
    <>
      <Header 
          title=""
          onLogoClick={() => navigate('/feed')}
      />
      <div className="feed-container">
        {items && items.length > 0 ? (
          items.map((item, index) => {
            const itemKey = item.id || `feed-item-${index}`;
            return (
              <motion.div
                key={itemKey}
                layoutId={itemKey}
                onClick={() => navigateToStoryTree(item.id)}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="feed-item"
              >
                {item.title && <motion.h3>{item.title}</motion.h3>}
                <motion.p>{item.text || 'No content available'}</motion.p>
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
