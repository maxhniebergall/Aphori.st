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
    const fetchFeedItems = async () => {
      setIsLoading(true);
      try {
        const response = await axios.get(`${process.env.REACT_APP_API_URL}/api/feed`, {
          params: { page: currentIndex },
        });

        if (response.data && response.data.items) {
          setItems(response.data.items);
        } else {
          setItems([]);
        }
      } catch (error) {
        console.error('Error fetching feed items:', error);
        setError('Failed to load feed items');
        setItems([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchFeedItems();
  }, [currentIndex]);

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
