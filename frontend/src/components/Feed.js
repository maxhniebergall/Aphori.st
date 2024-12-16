// components/Feed.js
import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import './Feed.css';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

// Add default story trees with proper structure
const DEFAULT_STORY_TREES = [
  {
    id: 'default-1',
    text: 'The aphorist collects knowledge in short sayings',
    title: 'The aphorist',
    nodes: [] // Empty nodes array for leaf nodes
  },
  {
    id: 'default-2',
    text: 'Where wisdom is discussed',
    title: 'Aphori.st is a social medium for good',
    nodes: []
  },
  {
    id: 'default-3',
    text: '1: a concise statement of a principle\n2: a terse formulation of a truth or sentiment : adage\n\n- https://www.merriam-webster.com/dictionary/aphorism',
    title: 'An aphorism',
    nodes: []
  }
];

function Feed() {
  const [items, setItems] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(1);
  const navigate = useNavigate();

  const navigateToStoryTree = useCallback(
    async (nodeId) => {
      // For default items, create a StoryTree first
      if (nodeId.startsWith('default-')) {
        try {
          const defaultItem = DEFAULT_STORY_TREES.find(item => item.id === nodeId);
          if (defaultItem) {
            const response = await axios.post(`${process.env.REACT_APP_API_URL}/api/createStoryTree`, {
              storyTree: defaultItem
            });
            // Navigate to the newly created StoryTree
            navigate(`/storyTree/${response.data.id}`);
          }
        } catch (error) {
          console.error('Error creating StoryTree:', error);
        }
      } else {
        navigate(`/storyTree/${nodeId}`);
      }
    }, [navigate]
  );

  // Fetch feed items
  useEffect(() => {
    const fetchFeedItems = async () => {
      console.log("Fetching feed items for page " + currentIndex)
      try {
        const response = await axios.get(`${process.env.REACT_APP_API_URL}/api/feed`, {
          params: { page: currentIndex },
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
