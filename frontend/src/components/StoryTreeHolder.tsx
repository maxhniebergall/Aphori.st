/**
 * Requirements:
 * - React, useCallback - For component rendering and memoization
 * - Display story tree with virtualized list
 * - Handle root node initialization and data fetching
 * - Properly size content accounting for header height
 * - Support sibling navigation
 * - Error handling for invalid root nodes
 * - Loading state management
 * - Proper cleanup on unmount
 * - Navigation handling
 * - Title and subtitle display
 * - Context provider wrapping
 * - Markdown editing and preview
 * - TypeScript support with strict typing
 * - Yarn for package management
 * - Proper error handling
 * - Loading state management
 * - Accessibility compliance
 * - Performance optimization
 * - Proper null checks and fallbacks
 * - Clear loading state after data is loaded
 */

import React, { useRef, useEffect, useState, useCallback, useMemo, ChangeEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import './StoryTree.css';
import Header from './Header';
import { StoryTreeProvider, useStoryTree } from '../context/StoryTreeContext';
import { ACTIONS, Quote } from '../context/types';
import VirtualizedStoryList from './VirtualizedStoryList';
import storyTreeOperator from '../operators/StoryTreeOperator';
import MDEditor, { ContextStore } from '@uiw/react-md-editor';
import '@uiw/react-md-editor/markdown-editor.css';
import rehypeSanitize from 'rehype-sanitize';
import { ReplyProvider, useReplyContext } from '../context/ReplyContext';

// Wrapper component for context providers
function StoryTreeHolder() {
  return (
    <StoryTreeProvider>
      <ReplyProvider>
        <StoryTreeContent />
      </ReplyProvider>
    </StoryTreeProvider>
  );
}

// Main content component
function StoryTreeContent() {
  const navigate = useNavigate();
  const { state, dispatch } = useStoryTree();
  const [isOperatorInitialized, setIsOperatorInitialized] = useState(false);
  const loadingTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // Get the UUID from the URL
  const { uuid: rootUUID } = useParams<{ uuid: string }>();

  const { 
    replyTarget, 
    setReplyTarget,
    replyContent,
    setReplyContent,
    selectionState,
    setSelectionState 
  } = useReplyContext();

  // Memoize editor options
  const editorOptions = useMemo(() => ({
    preview: "edit" as const,
    height: 200,
    textareaProps: {
      placeholder: "Write your reply using Markdown...",
      autoFocus: true,
      "aria-label": "Reply editor"
    },
    previewOptions: {
      rehypePlugins: [rehypeSanitize]
    }
  }), []);

  // Handle editor change with proper types
  const handleEditorChange = useCallback((
    value?: string,
    event?: ChangeEvent<HTMLTextAreaElement>,
    state?: ContextStore
  ) => {
    if (value !== undefined) {
      setReplyContent(value);
    }
  }, [setReplyContent]);
  
  // Initialize story tree and fetch data
  useEffect(() => {
    if (!isOperatorInitialized && rootUUID) {
      // Start loading the story tree
      storyTreeOperator.updateContext(state, dispatch);
      dispatch({ type: ACTIONS.START_STORY_TREE_LOAD, payload: { rootNodeId: rootUUID } });
      
      // Set loading indicator after delay if still loading
      loadingTimeoutRef.current = setTimeout(() => {
        dispatch({ type: ACTIONS.SHOW_LOADING_INDICATOR, payload: true });
      }, 150);

      // Fetch root node and initialize
      storyTreeOperator.fetchRootNode(rootUUID)
        .then(nodes => {
          if (nodes?.length) {
            dispatch({ 
              type: ACTIONS.SET_STORY_TREE_DATA, 
              payload: {
                levels: nodes,
                idToIndexPair: { indexMap: new Map() }
              }
            });
          }
        })
        .catch(error => {
          console.error('Error fetching story data:', error);
          dispatch({ type: ACTIONS.SET_ERROR, payload: 'Failed to load story tree' });
        });

      setIsOperatorInitialized(true);

      return () => {
        if (loadingTimeoutRef.current) {
          clearTimeout(loadingTimeoutRef.current);
        }
      };
    }
  }, [isOperatorInitialized, rootUUID, dispatch, state]);

  // Handle reply submission
  const handleReplySubmit = useCallback(async () => {
    if (!replyTarget || !selectionState || !replyContent.trim()) {
      console.warn('Missing required data for reply submission');
      return;
    }

    try {
      const quote: Quote = {
        quoteLiteral: replyTarget.textContent.slice(selectionState.start, selectionState.end),
        sourcePostId: replyTarget.rootNodeId,
        selectionRange: selectionState
      };

      const result = await storyTreeOperator.submitReply(
        replyTarget.rootNodeId,
        replyContent,
        quote
      );
      
      if (result.success) {
        setReplyContent('');
        setReplyTarget(null);
        setSelectionState(null);
      } else {
        throw new Error('Failed to submit reply');
      }
    } catch (error) {
      console.error('Error submitting reply:', error);
      dispatch({ type: ACTIONS.SET_ERROR, payload: 'Failed to submit reply' });
    }
  }, [replyTarget, selectionState, replyContent, setReplyContent, setReplyTarget, setSelectionState, dispatch]);

  // Handle reply cancellation
  const handleReplyCancel = useCallback(() => {
    setReplyContent('');
    setReplyTarget(null);
    setSelectionState(null);
  }, [setReplyContent, setReplyTarget, setSelectionState]);

  // Render loading state
  if (state.isLoading) {
    return (
      <div className="loading-container" role="alert" aria-busy="true">
        <div className="loading-spinner"></div>
        <span>Loading story tree...</span>
      </div>
    );
  }

  // Render reply editor
  const renderReplyEditor = () => {
    if (!replyTarget || !selectionState) {
      return null;
    }

    return (
      <div 
        className="reply-editor-container"
        role="form"
        aria-label="Reply editor form"
      >
        <div data-color-mode="light">
          <MDEditor
            value={replyContent}
            onChange={handleEditorChange}
            {...editorOptions}
          />
        </div>
        <div className="reply-actions" role="group" aria-label="Reply actions">
          <button 
            onClick={handleReplySubmit}
            disabled={!replyContent.trim()}
            className="submit-reply-button"
            aria-label="Submit reply"
          >
            Submit
          </button>
          <button 
            onClick={handleReplyCancel}
            className="cancel-reply-button"
            aria-label="Cancel reply"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  };

  // Show error state if present
  if (state.error) {
    return (
      <div className="error-container" role="alert">
        <div className="error-message">{state.error}</div>
        <button 
          onClick={() => navigate('/feed')}
          className="error-action"
          aria-label="Return to feed"
        >
          Return to Feed
        </button>
      </div>
    );
  }

  return (
    <div className="story-tree-container">
      <div className="story-tree-header">
        <Header 
          title="Story Tree"
          subtitle="View and reply to stories"
          onLogoClick={() => navigate('/feed')}
        />
      </div>
      <main className="story-tree-content" role="main">
        <VirtualizedStoryList
          postRootId={rootUUID || ''}
        />
        {renderReplyEditor()}
      </main>
    </div>
  );
}

export default StoryTreeHolder;