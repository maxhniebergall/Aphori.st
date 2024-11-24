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
      style={{ 
        cursor: 'pointer',
        marginBottom: '1.5rem'
      }}
    >
      <animated.div 
        {...bind()} 
        style={{ 
          x,
          touchAction: 'none'
        }} 
        id={node.id}
      >
        <motion.p style={{ 
          fontSize: '1.1rem',
          lineHeight: '1.6',
          color: '#333',
          whiteSpace: 'pre-wrap'
        }}>
          {node.text}
        </motion.p>
      </animated.div>
    </motion.div>
  );
}

export default StoryTreeNode; 