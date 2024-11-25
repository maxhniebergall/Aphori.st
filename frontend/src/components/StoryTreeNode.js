import React from 'react';
import { useSpring, animated } from 'react-spring';
import { useGesture } from '@use-gesture/react';
import { motion } from 'framer-motion';

// This is a single node in the story tree. It is used to display a single node in the story tree.
// It controls the swipe gesture to remove the node from the view, and the animation when the node is focused.
function StoryTreeNode({ node, onSwipeLeft, index, setCurrentFocus }) {
  const [{ x }, api] = useSpring(() => ({ x: 0 }));

  const bind = useGesture({
    onDrag: ({ down, movement: [mx], cancel }) => {
      if (index === 0) {
        cancel();
        return;
      }

      if (!down && mx < -100) {
        onSwipeLeft(node);
        cancel();
      } else {
        api.start({ x: down ? mx : 0 });
      }
    },
  }, {
    drag: {
      axis: 'x',
      enabled: index > 0
    },
  });

  return (
    <motion.div
      key={node.id}
      layoutId={node.id}
      onClick={() => setCurrentFocus(index)}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className={`story-tree-node ${index === 0 ? 'root-node' : ''}`}
    >
      <animated.div 
        {...bind()} 
        style={{ x }} 
        className="story-tree-node-content"
        id={node.id}
      >
        <div className="story-tree-node-text">
          {node.text}
        </div>
      </animated.div>
    </motion.div>
  );
}

export default StoryTreeNode; 