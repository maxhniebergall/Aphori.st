import React, { useState, useCallback, useEffect } from 'react';
import { useGesture } from '@use-gesture/react';
import { motion } from 'framer-motion';
import { storyTreeOperator } from '../operators/StoryTreeOperator';
import { useStoryTree } from '../context/StoryTreeContext';
import MDEditor from '@uiw/react-md-editor';
/*
 * Requirements:
 * - Proper null checking for node and node.id
 * - Safe handling of undefined siblings
 * - Proper state management for sibling navigation
 * - Gesture handling for sibling navigation
 * - Hooks must be called in the same order every render
 * - Use StoryTreeOperator for node fetching
 * - Markdown rendering support with GitHub-flavored markdown
 * - Reply functionality with node targeting
 */

function StoryTreeNode({ node, index, setCurrentFocus, siblings, onSiblingChange, onReplyClick, isReplyMode, isReplyTarget, onReplySubmit }) {
  // All hooks must be called before any conditional returns
  const [currentSiblingIndex, setCurrentSiblingIndex] = useState(0);
  const [loadedSiblings, setLoadedSiblings] = useState([node || {}]);
  const [isLoadingSibling, setIsLoadingSibling] = useState(false);
  const { state, dispatch } = useStoryTree();
  const [replyContent, setReplyContent] = useState('');

  // Update the operator's context whenever state or dispatch changes
  useEffect(() => {
    storyTreeOperator.updateContext(state, dispatch);
  }, [state, dispatch]);

  // Find the current index in siblings array
  useEffect(() => {
    if (Array.isArray(siblings) && node?.id) {
      const index = siblings.findIndex(sibling => sibling?.id === node.id);
      setCurrentSiblingIndex(index !== -1 ? index : 0);
    }
  }, [node?.id, siblings]);

  const loadNextSibling = useCallback(async () => {
    if (isLoadingSibling || !siblings || currentSiblingIndex >= siblings.length - 1) return;
    
    setIsLoadingSibling(true);
    try {
      const nextSibling = siblings[currentSiblingIndex + 1];
      if (!nextSibling?.id) {
        console.warn('Invalid next sibling:', nextSibling);
        return;
      }
      
      const nextNode = await storyTreeOperator.fetchNode(nextSibling.id);
      if (nextNode) {
        nextNode.siblings = siblings; // Preserve siblings information
        setLoadedSiblings(prev => [...prev, nextNode]);
        setCurrentSiblingIndex(prev => prev + 1);
        onSiblingChange?.(nextNode);
      }
    } catch (error) {
      console.error('Error loading sibling:', error);
    } finally {
      setIsLoadingSibling(false);
    }
  }, [siblings, currentSiblingIndex, isLoadingSibling, onSiblingChange]);

  const loadPreviousSibling = useCallback(async () => {
    if (isLoadingSibling || !siblings || currentSiblingIndex <= 0) {
      console.log('Cannot go back: at first sibling or loading');
      return;
    }

    setIsLoadingSibling(true);
    try {
      const previousSibling = siblings[currentSiblingIndex - 1];
      if (!previousSibling?.id) {
        console.warn('Invalid previous sibling:', previousSibling);
        return;
      }

      const previousNode = await storyTreeOperator.fetchNode(previousSibling.id);
      if (previousNode) {
        previousNode.siblings = siblings;
        
        setLoadedSiblings(prev => {
          const newLoadedSiblings = [...prev];
          newLoadedSiblings[currentSiblingIndex - 1] = previousNode;
          return newLoadedSiblings;
        });
        
        setCurrentSiblingIndex(prev => prev - 1);
        onSiblingChange?.(previousNode);
      }
    } catch (error) {
      console.error('Error loading previous sibling:', error);
    } finally {
      setIsLoadingSibling(false);
    }
  }, [currentSiblingIndex, siblings, isLoadingSibling, onSiblingChange]);

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
      enabled: siblings && (currentSiblingIndex > 0 || currentSiblingIndex < siblings.length - 1)
    },
  });

  const handleReplyClick = useCallback((e) => {
    e.stopPropagation();
    if (onReplyClick) {
      onReplyClick(node.id);
    }
  }, [onReplyClick, node.id]);

  // Early return if node is not properly defined
  if (!node?.id) {
    console.warn('StoryTreeNode received invalid node:', node);
    return null;
  }

  // Early return if operator is not provided
  if (!storyTreeOperator?.fetchNode) {
    console.error('StoryTreeNode requires a valid operator with fetchNode method');
    return null;
  }

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
        <Markdown
          components={{
            a: ({ node, children, ...props }) => (
              <a target="_blank" rel="noopener noreferrer" {...props}>
                {children}
              </a>
            ),
          }}
        >
            {currentSibling.text}
          </Markdown>

        <div className="story-tree-node-footer">
        <div className="footer-left">
            <button 
              className="reply-button"
              onClick={handleReplyClick}
            aria-label="Reply to this message"
          >
              {isReplyTarget ? 'Cancel Reply' : 'Reply'}
            </button>
          </div>
          <div className="footer-right">
            {hasSiblings && (
              <div className="sibling-indicator">
                {currentSiblingIndex + 1} / {siblings.length}
                {(hasNextSibling || hasPreviousSibling) && (
                  <span className="swipe-hint">
                    {hasPreviousSibling && <span className="swipe-hint-previous" onClick={loadPreviousSibling}> (Swipe right for previous)</span>}
                    {hasPreviousSibling && hasNextSibling && ' |'}
                    {hasNextSibling && <span className="swipe-hint-next" onClick={loadNextSibling}>   (Swipe left for next)</span>}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {isReplyTarget && (
          <div className="reply-editor-container">
            <div data-color-mode="light">
              <MDEditor
                value={replyContent}
                onChange={setReplyContent}
                preview="edit"
                height={200}
                textareaProps={{
                  placeholder: "Write your reply using Markdown..."
                }}
              />
            </div>
            <div className="reply-actions">
              <button 
                onClick={() => onReplySubmit(replyContent)}
                disabled={!replyContent.trim()}
                className="submit-reply-button"
              >
                Submit Reply
              </button>
              <button 
                onClick={() => onReplyClick(null)}
                className="cancel-reply-button"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default StoryTreeNode; 