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
      if (!down && mx < -100) {
        onSwipeLeft(node);
        cancel();
      } else {
        api.start({ x: down ? mx : 0 });
      }
    },
  }, {
    drag: { axis: 'x' },
  });

  return (
    <motion.div
      key={node.id}
      layoutId={node.id}
      onClick={() => setCurrentFocus(index)}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{ 
        cursor: 'pointer',
        width: '100%',
        height: 'auto'
      }}
    >
      <animated.div 
        {...bind()} 
        style={{ 
          x,
          touchAction: 'none',
          width: '100%',
          height: 'auto'
        }} 
        id={node.id}
      >
        <div 
          style={{
            width: '100%',
            maxWidth: '100%',
            wordBreak: 'break-word',
            whiteSpace: 'pre-wrap'
          }}
        >
          {node.text}
        </div>
      </animated.div>
    </motion.div>
  );
}

export default StoryTreeNode; 