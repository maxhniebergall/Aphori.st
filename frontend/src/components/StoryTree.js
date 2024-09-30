// components/StoryTree.js
import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import './StoryTree.css';
import axios from 'axios';

function StoryTree() {
  const [storyData, setStoryData] = useState(null);
  const [currentNodeIndex, setCurrentNodeIndex] = useState(0);
  const [showMetadataPage, setShowMetadataPage] = useState(false);
  const [showMainContent, setShowMainContent] = useState(true);

  const { uuid } = useParams(); // Get the UUID from the URL
  const navigate = useNavigate();

  const updateURLWithNodeUUID = useCallback(
    (nodeUUID) => {
    navigate(`/storyTree/${nodeUUID}`, { replace: true });
  }, [navigate]);

  useEffect(() => {
    if (!uuid) {
      // Handle missing UUID
      console.error('UUID is missing from URL');
      return;
    }

    const fetchStoryData = async () => {
        try {
          console.log('Fetching story data for UUID:', uuid);
          const response = await axios.get(`${process.env.REACT_APP_API_URL}/api/storyTree/${uuid}`);
            
  
          const data = response.data;
          console.log('Received data:', data);

          // Find index of node with initial UUID
          const index = data.nodes.findIndex((node) => node.id === uuid);
          if (index !== -1) {
            setCurrentNodeIndex(index);
          } else {
            // UUID not found, default to first node
            setCurrentNodeIndex(0);
            updateURLWithNodeUUID(data.nodes[0].id);
          }
  
          setStoryData(data);
        } catch (error) {
          console.error('Error fetching story data:', error);
        }
  };
  
  fetchStoryData();

  }, [uuid, updateURLWithNodeUUID]);
  
  const handleScroll = (direction) => {
    let newIndex = currentNodeIndex;

    if (direction === 'next' && currentNodeIndex < storyData.nodes.length - 1) {
      newIndex += 1;
    } else if (direction === 'prev' && currentNodeIndex > 0) {
      newIndex -= 1;
    }

    if (newIndex !== currentNodeIndex) {
      setCurrentNodeIndex(newIndex);
      updateURLWithNodeUUID(storyData.nodes[newIndex].id);
    }
  };

  const handleSwipeRight = () => {
    setShowMainContent(false);
  };

  const handleSwipeLeft = () => {
    setShowMetadataPage(true);
  };

  if (!storyData) {
    return <div>Loading...</div>;
  }

  return (
    <div className="story-tree-container">
      {/* Metadata View */}
      {!showMainContent && (
        <div className="story-metadata">
          <h1>{storyData.metadata.title}</h1>
          <p>By {storyData.metadata.author}</p>
          <button onClick={() => setShowMainContent(true)}>Continue Reading</button>
        </div>
      )}

      {/* Main Content with Gestures */}
      {showMainContent && (
        <motion.div
          className="story-content"
          drag
          dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
          onDragEnd={(event, info) => {
            // Horizontal swipe detection
            if (info.offset.x > 100) {
              handleSwipeRight();
            } else if (info.offset.x < -100) {
              handleSwipeLeft();
            }

            // Vertical swipe detection
            if (info.offset.y < -100) {
              handleScroll('next');
            } else if (info.offset.y > 100) {
              handleScroll('prev');
            }
          }}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={storyData.nodes[currentNodeIndex].id}
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -50 }}
              transition={{ duration: 0.3 }}
            >
              <p>{storyData.nodes[currentNodeIndex].text}</p>
            </motion.div>
          </AnimatePresence>

          {/* Action Buttons */}
          <div className="action-buttons">
            <button>Vote</button>
            {/* Add more buttons as needed */}
          </div>
        </motion.div>
      )}

      {/* Metadata Page */}
      <AnimatePresence>
        {showMetadataPage && (
          <motion.div
            className="metadata-page"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.3 }}
            drag="x"
            dragConstraints={{ right: 0 }}
            onDragEnd={(event, info) => {
              if (info.offset.x > 100) {
                setShowMetadataPage(false);
              }
            }}
          >
            <button onClick={() => setShowMetadataPage(false)}>Close</button>
            <h2>Metadata Page</h2>
            {/* Sorting options and related nodes */}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default StoryTree;
