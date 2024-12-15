import React, { useState, useCallback, useEffect } from 'react';
import { useGesture } from '@use-gesture/react';
import { motion } from 'framer-motion';
import axios from 'axios';

// This is a single node in the story tree. It is used to display a single node in the story tree.
// It controls the swipe gesture to remove the node from the view, and the animation when the node is focused.
function StoryTreeNode({ node, index, setCurrentFocus, siblings, onSiblingChange }) {
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
      onSiblingChange?.(nextNode);
    } catch (error) {
      console.error('Error loading sibling:', error);
    } finally {
      setIsLoadingSibling(false);
    }
  }, [siblings, currentSiblingIndex, isLoadingSibling, onSiblingChange]);

  const loadPreviousSibling = useCallback(async () => {
    console.log('Loading previous sibling:', { 
      currentSiblingIndex, 
      loadedSiblingsLength: loadedSiblings.length,
      loadedSiblings
    });
    
    if (isLoadingSibling || !siblings || currentSiblingIndex <= 0) {
      console.log('Cannot go back: at first sibling or loading');
      return;
    }

    setIsLoadingSibling(true);
    try {
      const previousSibling = siblings[currentSiblingIndex - 1];
      const response = await axios.get(
        `${process.env.REACT_APP_API_URL}/api/storyTree/${previousSibling.id}`
      );
      const previousNode = response.data;
      previousNode.siblings = siblings;
      
      // Insert the previous node at the correct position
      setLoadedSiblings(prev => {
        const newLoadedSiblings = [...prev];
        newLoadedSiblings[currentSiblingIndex - 1] = previousNode;
        return newLoadedSiblings;
      });
      
      setCurrentSiblingIndex(prev => prev - 1);
      onSiblingChange?.(previousNode);
    } catch (error) {
      console.error('Error loading previous sibling:', error);
    } finally {
      setIsLoadingSibling(false);
    }
  }, [currentSiblingIndex, loadedSiblings, siblings, isLoadingSibling, onSiblingChange]);

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
      className="story-tree-node"
    >
      <div 
        {...bind()} 
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
      </div>
    </motion.div>
  );
}

export default StoryTreeNode; 