// components/Feed.js
import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import './Feed.css';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

// Add default story trees
const DEFAULT_STORY_TREES = [
  {
    id: 'default-1',
    text: 'The aphorist collects knowledge in short sayings',
    title: 'The aphorist'
  },
  {
    id: 'default-2',
    text: 'Where wisdom is discussed',
    title: 'Aphori.st is a social medium for good'
  },
  {
    id: 'default-3',
    text: '1: a concise statement of a principle\n2: a terse formulation of a truth or sentiment : adage\n\n- https://www.merriam-webster.com/dictionary/aphorism',
    title: 'An aphorism'
  }
];

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
        
        // Select a random default story tree
        const randomDefault = DEFAULT_STORY_TREES[Math.floor(Math.random() * DEFAULT_STORY_TREES.length)];
        
        // Combine default story with fetched items
        setItems([randomDefault, ...data.items]);
      } catch (error) {
        console.error('Error fetching feed items:', error);
        // Still show default story even if fetch fails
        const randomDefault = DEFAULT_STORY_TREES[Math.floor(Math.random() * DEFAULT_STORY_TREES.length)];
        setItems([randomDefault]);
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
            {item.title && <motion.h3>{item.title}</motion.h3>}
            <motion.p>{item.text}</motion.p>
          </motion.div>
        ))
      }
    </div>
  );
}

export default Feed;
