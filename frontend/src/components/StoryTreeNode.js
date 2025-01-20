import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useGesture } from '@use-gesture/react';
import { motion } from 'framer-motion';
import { storyTreeOperator } from '../operators/StoryTreeOperator';
import { useStoryTree } from '../context/StoryTreeContext';
import MDEditor from '@uiw/react-md-editor';
import '@uiw/react-md-editor/markdown-editor.css';
import rehypeSanitize from 'rehype-sanitize';
import TextSelection from './TextSelection';
/*
 * Requirements:
 * - @use-gesture/react: For gesture handling
 * - framer-motion: For animations
 * - @uiw/react-md-editor: For markdown editing and preview
 * - @uiw/react-md-editor/markdown-editor.css: Required CSS for markdown editor
 * - react: Core React functionality
 * - rehype-sanitize: For markdown sanitization (required by md-editor)
 * - Proper null checking for node and node.id
 * - Safe handling of undefined siblings
 * - Proper state management for sibling navigation
 * - Gesture handling for sibling navigation
 * - Hooks must be called in the same order every render
 * - Use StoryTreeOperator for node fetching
 * - Markdown rendering support with GitHub-flavored markdown
 * - Reply functionality with node targeting
 * - Text selection support for replies
 * - Quote preview in reply mode
 * - Selection persistence via DOM
 * - Selection handles
 * - Single reply editor display management
 * - Dynamic height adjustments for reply editor
 * - Proper cleanup of reply editor state
 */

function StoryTreeNode({
  postRootId, 
  node, 
  siblings, 
  onSiblingChange,
}) {
  console.log('StoryTreeNode rendering:', { 
    nodeId: node?.id });

  const [currentSiblingIndex, setCurrentSiblingIndex] = useState(0);
  const [loadedSiblings, setLoadedSiblings] = useState([node || {}]);
  const [isLoadingSibling, setIsLoadingSibling] = useState(false);
  const { state, dispatch } = useStoryTree();
  const [replyContent, setReplyContent] = useState('');
  const [selectionState, setSelectionState] = useState(null);
  const [selectAll, setSelectAll] = useState(false);
  const [clearSelection, setClearSelection] = useState(false);
  const nodeRef = useRef(null);

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

  const onReplySubmit = useCallback(async (replyData) => {
    try {
      const result = await storyTreeOperator.submitReply(
        node.id,
        replyData.content,
        replyData.quote ? {
          quote: replyData.quote,
          sourcePostId: replyData.sourcePostId,
          selectionRange: replyData.selectionRange
        } : null
      );
      if (result) {
        setReplyContent('');
      }
    } catch (error) {
      console.error('Error submitting reply:', error);
    }
  }, [node.id]);

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

  const renderQuote = () => {
    if (!currentSibling?.metadata?.quote) return null;

    const { quote } = currentSibling.metadata;
    return (
      <div className="story-tree-node-quote">
        {quote.text}
        <div className="story-tree-node-quote-source">
          Quoted from <a href={`/storyTree/${quote.sourcePostId}`}>original post</a>
        </div>
      </div>
    );
  };

  const handleReplyButtonClick = () => {
    try {
      console.log('Reply button clicked:', { 
        currentSelectionState: selectionState      });
      
      setClearSelection(false);
      
      if (selectionState) {
        console.log('Canceling reply');
        setSelectionState(null);
        setSelectAll(false);
        setClearSelection(true);
        setTimeout(() => {
          setClearSelection(false);
        }, 0);
      } else {
        console.log('Opening reply editor');
        const currentSibling = loadedSiblings[currentSiblingIndex] || node;
        if (!currentSibling?.text) {
          console.warn('Cannot open reply editor: invalid text content');
          return;
        }
        setSelectionState({
          start: 0,
          end: currentSibling.text.length
        });
        setSelectAll(true);
      }
    } catch (error) {
      console.error('Error handling reply button click:', error);
      // Ensure we clean up state in case of error
      setSelectionState(null);
      setSelectAll(false);
      setClearSelection(false);
    }
  };

  const renderContent = () => {
    const currentSibling = loadedSiblings[currentSiblingIndex] || node;
    if (!currentSibling?.text) {
      return null;
    }
    return (
      <div className="story-tree-node-text">
        {renderQuote()} 
        <TextSelection 
          onSelectionCompleted={(selection) => {
            setSelectionState(selection);
            setSelectAll(false);
          }}
          key={""+postRootId+currentSibling.id}
          selectAll={selectAll}
          clearSelection={clearSelection}
        >
          {currentSibling.text}
        </TextSelection>
      </div>
    );
  };

  const renderReplyEditor = () => {
    console.log('Attempting to render reply editor:', {
      hasSelectionState: !!selectionState,
      willRender: !!(selectionState)
    });

    if (!selectionState) return null;

    const selectedText = currentSibling.text.slice(selectionState.start, selectionState.end);

    return (
      <div className="reply-editor-container">
        {selectedText && (
          <div className="quote-preview">
            <blockquote>
              {selectedText}
            </blockquote>
          </div>
        )}
        <div data-color-mode="light">
          <MDEditor
            value={replyContent}
            onChange={setReplyContent}
            preview="edit"
            height={200}
            textareaProps={{
              placeholder: "Write your reply using Markdown...",
              autoFocus: true
            }}
            previewOptions={{
              rehypePlugins: [[rehypeSanitize]]
            }}
          />
        </div>
        <div className="reply-actions">
          <button 
            onClick={() => {
              onReplySubmit({
                content: replyContent,
                quote: selectedText,
                sourcePostId: currentSibling.id,
                selectionRange: selectionState
              });
            }}
            disabled={!replyContent.trim()}
            className="submit-reply-button"
          >
            Submit
          </button>
          <button 
            onClick={() => {
              setSelectionState(null);
            }}
            className="cancel-reply-button"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  };

  return (
    <motion.div
      className={`story-tree-node}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      ref={nodeRef}
    >
      <div 
        {...bind()} 
        className={`story-tree-node-content ${hasSiblings ? 'has-siblings' : ''}`}
        id={currentSibling.id}
      >
        {renderContent()}
        {selectionState && renderReplyEditor()}
        <div className="story-tree-node-footer">
          <div className="footer-left">
            <button 
              className="reply-button"
              onClick={handleReplyButtonClick}
              aria-label="Reply to this message"
            >
              {selectionState ? 'Cancel Reply' : 'Reply'}
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
      </div>
    </motion.div>
  );
}

export default StoryTreeNode; 