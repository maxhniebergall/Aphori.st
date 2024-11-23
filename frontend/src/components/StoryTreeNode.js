import React from 'react';
import { useSpring, animated } from 'react-spring';
import { useGesture } from '@use-gesture/react';
import { motion } from 'framer-motion';

function StoryTreeNode({ node, onSwipeLeft, index, setCurrentFocus }) {
  const [{ x }, api] = useSpring(() => ({ x: 0 }));

  const bind = useGesture(
    {
      onDrag: ({ down, movement: [mx], cancel }) => {
        if (!down && mx < -100) {
          onSwipeLeft(node);
          cancel();
        } else {
          api.start({ x: down ? mx : 0 });
        }
      },
    },
    {
      drag: { axis: 'x' },
    }
  );

  return (
    <motion.div
      key={node.id}
      layoutId={node.id}
      onClick={() => setCurrentFocus(index)}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{ cursor: 'pointer', margin: '10px', padding: '10px', border: '1px solid #ccc' }}
    >
      <animated.div {...bind()} style={{ x }} className="story-node" id={node.id}>
        <motion.h5>{node.id}</motion.h5>
        <motion.h2>{node.text}</motion.h2>
      </animated.div>
    </motion.div>
  );
}

export default StoryTreeNode; 