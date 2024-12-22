// components/Feed.js
import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import './Feed.css';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import Header from './Header';

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
        const response = await axios.get(`${process.env.REACT_APP_API_URL}/api/feed`, {
          params: { page: currentIndex },
        });
        console.log('Feed: Received response:', response.data);

        if (response.data && response.data.items) {
          console.log('Feed: Setting items:', response.data.items);
          setItems(response.data.items);
        } else {
          console.log('Feed: No items in response, setting empty array');
          setItems([]);
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
          items.map(item => (
            <motion.div
              key={item.id}
              layoutId={item.id}
              onClick={() => navigateToStoryTree(item.id)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="feed-item"
            >
              {item.title && <motion.h3>{item.title}</motion.h3>}
              <motion.p>{item.text}</motion.p>
            </motion.div>
          ))
        ) : (
          <div>No items to display</div>
        )}
      </div>
    </>
  );
}

export default Feed;
