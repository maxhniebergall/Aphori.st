import React, { useState, useCallback, useEffect } from 'react';
import { useSpring, animated } from 'react-spring';
import { useGesture } from '@use-gesture/react';
import { motion } from 'framer-motion';
import axios from 'axios';

// This is a single node in the story tree. It is used to display a single node in the story tree.
// It controls the swipe gesture to remove the node from the view, and the animation when the node is focused.
function StoryTreeNode({ node, index, setCurrentFocus, siblings }) {
  const [{ x }, api] = useSpring(() => ({ x: 0 }));
  const [currentSiblingIndex, setCurrentSiblingIndex] = useState(0);
  const [loadedSiblings, setLoadedSiblings] = useState([node]);
  const [isLoadingSibling, setIsLoadingSibling] = useState(false);

  // Find the current index in siblings array
  useEffect(() => {
    if (siblings) {
      const index = siblings.findIndex(sibling => sibling.id === node.id);
      setCurrentSiblingIndex(index !== -1 ? index : 0);
    }
  }, [node.id, siblings]);

  const loadNextSibling = useCallback(async () => {
    if (isLoadingSibling || !siblings || currentSiblingIndex >= siblings.length - 1) return;
    
    setIsLoadingSibling(true);
    try {
      const nextSibling = siblings[currentSiblingIndex + 1];
      const response = await axios.get(
        `${process.env.REACT_APP_API_URL}/api/storyTree/${nextSibling.id}`
      );
      const nextNode = response.data;
      nextNode.siblings = siblings; // Preserve siblings information
      setLoadedSiblings(prev => [...prev, nextNode]);
      setCurrentSiblingIndex(prev => prev + 1);
    } catch (error) {
      console.error('Error loading sibling:', error);
    } finally {
      setIsLoadingSibling(false);
    }
  }, [siblings, currentSiblingIndex, isLoadingSibling]);

  const loadPreviousSibling = useCallback(() => {
    if (currentSiblingIndex <= 0) return;
    setCurrentSiblingIndex(prev => prev - 1);
  }, [currentSiblingIndex]);

  const bind = useGesture({
    onDrag: ({ down, movement: [mx], cancel, velocity: [vx] }) => {
      if (!down) {
        // Swipe left to see next sibling (negative movement)
        if ((mx < -100 || (vx < -0.5 && mx < -50)) && siblings && currentSiblingIndex < siblings.length - 1) {
          loadNextSibling();
          cancel();
        }
        // Swipe right to see previous sibling (positive movement)
        else if ((mx > 100 || (vx > 0.5 && mx > 50)) && currentSiblingIndex > 0) {
          loadPreviousSibling();
          cancel();
        }
      }
      
      // Limit the drag distance
      const boundedX = Math.max(-200, Math.min(200, mx));
      api.start({ x: down ? boundedX : 0, immediate: down });
    },
  }, {
    drag: {
      axis: 'x',
      // Enable dragging if there are siblings to navigate through
      enabled: siblings && (currentSiblingIndex > 0 || currentSiblingIndex < siblings.length - 1)
    },
  });

  const currentSibling = loadedSiblings[currentSiblingIndex] || node;
  const hasSiblings = siblings && siblings.length > 1;
  const hasNextSibling = siblings && currentSiblingIndex < siblings.length - 1;
  const hasPreviousSibling = currentSiblingIndex > 0;

  return (
    <motion.div
      key={currentSibling.id}
      layoutId={currentSibling.id}
      onClick={() => setCurrentFocus(index)}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="story-tree-node"
    >
      <animated.div 
        {...bind()} 
        style={{ x }} 
        className={`story-tree-node-content ${hasSiblings ? 'has-siblings' : ''}`}
        id={currentSibling.id}
      >
        <div className="story-tree-node-text">
          {currentSibling.text}
          {hasSiblings && (
            <div className="sibling-indicator">
              {currentSiblingIndex + 1} / {siblings.length}
              {(hasNextSibling || hasPreviousSibling) && (
                <span className="swipe-hint">
                  {hasPreviousSibling && ' (Swipe right for previous)'}
                  {hasPreviousSibling && hasNextSibling && ' |'}
                  {hasNextSibling && ' (Swipe left for next)'}
                </span>
              )}
            </div>
          )}
        </div>
      </animated.div>
    </motion.div>
  );
}

export default StoryTreeNode; 