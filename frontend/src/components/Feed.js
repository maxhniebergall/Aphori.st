// components/Feed.js
import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import './Feed.css';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

function Feed() {
  const [items, setItems] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(1);
  const navigate = useNavigate();

  const navigateToStoryTree = useCallback(
    (nodeId) => {
      navigate(`/storyTree/${nodeId}`);
    }, [navigate]
  );

  // Fetch feed items
  useEffect(() => {
    const fetchFeedItems = async () => {
      console.log("Fetching feed items for page " + currentIndex)
      try {
        const response = await axios.get(`${process.env.REACT_APP_API_URL}/api/feed`, {
          query: { "page": currentIndex },
        });

        const data = response.data;
        console.log("received feed items" + JSON.stringify(data))
        setItems(data.items);
      } catch (error) {
        console.error('Error fetching feed items:', error);
      }
    };

    fetchFeedItems();
  }, [currentIndex]);

  return (
    <div>
      {
        items.map(item => (
          <motion.div
            key={item.id}
            layoutId={item.id}
            onClick={() => navigateToStoryTree(item.id)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ cursor: 'pointer', margin: '10px', padding: '10px', border: '1px solid #ccc' }}
          >
            <motion.h5>{item.id}</motion.h5>
            <motion.h2>{item.text}</motion.h2>
          </motion.div>
        ))
      }
    </div>
  );
}

export default Feed;
