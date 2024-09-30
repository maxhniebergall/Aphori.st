// components/Feed.js
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import './Feed.css'; // Create a CSS file for styling
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

function Feed() {
  const [feedItems, setFeedItems] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(1);
  const navigate = useNavigate();

  // Fetch feed items
  useEffect(() => {
    const fetchFeedItems = async () => {
      console.log("Fetching feed items for page " + currentIndex)
      try {
          const response = await axios.get(`${process.env.REACT_APP_API_URL}/api/feed`, {
          query: { "page":currentIndex },
        });

        const data = response.data;
        console.log("recieved feed items" + JSON.stringify(data))
        setFeedItems(data.items);
      } catch (error) {
        console.error('Error fetching feed items:', error);
      }
    };

    fetchFeedItems();
  }, [currentIndex]);

  // Handle swiping up and down to navigate the feed
  const handleSwipeVertical = (offsetY) => {
    if (offsetY < -100 && currentIndex < feedItems.length - 1) {
      // Swiped up, go to next item
      setCurrentIndex(currentIndex + 1);
    } else if (offsetY > 100 && currentIndex > 0) {
      // Swiped down, go to previous item
      setCurrentIndex(currentIndex - 1);
    } 
  };

  const handleSwipeHorizontal = (offsetX) => {
    if (offsetX < -100) {
      // Swiped left, open as StoryTree
      navigate(`/storyTree/${feedItems[currentIndex].id}`);
    } else if (offsetX > 100) {
      // Swiped right, open metadata tab
    }
  };

  return (
    <div className="feed-container">
      {feedItems.length > 0 && (
        <motion.div
          key={feedItems[currentIndex].id}
          className="feed-item"
          drag
          dragConstraints={{ top: 0, bottom: 0, left: 0, right: 0 }}
          onDragEnd={(event, info) => {
            handleSwipeVertical(info.offset.y);
            handleSwipeHorizontal(info.offset.x);
          }}
        >
          <p>{feedItems[currentIndex].text}</p>
        </motion.div>
      )}
    </div>
  );
}

export default Feed;
