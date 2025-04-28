/**
 * Requirements:
 * - React, useCallback - For component rendering and memoization
 * - Display story tree with virtualized list via VirtualizedStoryList (which now handles progressive loading)
 * - Handle root node initialization and data fetching (delegated to context and storyTreeOperator)
 * - Properly size content accounting for header height
 * - Support sibling navigation
 * - Error handling for invalid root nodes
 * - **Simplified loading state management:** rely on VirtualizedStoryList for progressive loading (global loading indicator removed)
 * - Proper cleanup on unmount
 * - Navigation handling
 * - Title and subtitle display
 * - Context provider wrapping
 * - Markdown editing and preview
 * - TypeScript support with strict typing
 * - Yarn for package management
 * - Proper error handling and accessibility compliance
 * - Performance optimization and proper null checks/fallbacks
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import './StoryTree.css';
import Header from './Header';
import { StoryTreeProvider, useStoryTree } from '../context/StoryTreeContext';
import VirtualizedStoryList from './VirtualizedStoryList';
import MDEditor from '@uiw/react-md-editor';
import '@uiw/react-md-editor/markdown-editor.css';
import rehypeSanitize from 'rehype-sanitize';
import { ReplyProvider, useReplyContext } from '../context/ReplyContext';
import StoryTreeOperator from '../operators/StoryTreeOperator';
import React from 'react';
import { useUser } from '../context/UserContext';

// Memoized content component to prevent unnecessary re-renders
const MemoizedVirtualizedStoryList = React.memo(VirtualizedStoryList);

// Separate Reply Editor component to isolate rendering when content changes
const ReplyEditor = () => {
  const { 
    replyTarget, 
    replyContent,
    setReplyContent,
    replyQuote,
    setReplyTarget,
    setReplyQuote 
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
  ) => {
    if (value !== undefined) {
      setReplyContent(value);
    }
  }, [setReplyContent]);
  
  // Handle reply cancellation
  const handleReplyFinished = useCallback(() => {
    // used for both cancel and submit
    setReplyContent('');
    setReplyTarget(null);
    setReplyQuote(null);
  }, [setReplyContent, setReplyTarget, setReplyQuote]);

  if (!replyTarget || !replyQuote) {
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
          onClick={async () => {
            try {
              const result = await StoryTreeOperator.submitReply(replyContent, replyTarget.id, replyQuote);
              if (!result.error) {
                handleReplyFinished();
              }
            } catch (error) {
              console.error("Error during reply submission:", error);
            }
          }}
          disabled={!replyContent.trim()}
          className="submit-reply-button"
          aria-label="Submit reply"
        >
          Submit
        </button>
        <button 
          onClick={handleReplyFinished}
          className="cancel-reply-button"
          aria-label="Cancel reply"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

// Main content component
function StoryTreeContent() {
  const navigate = useNavigate();
  const { state } = useStoryTree();
  const { uuid: rootUUID } = useParams<{ uuid: string }>();


  // Use a minimal set of context values to prevent re-renders when replyContent changes
  const { replyTarget } = useReplyContext();

  // Instead of returning a global loading spinner, we let VirtualizedStoryList handle progressive loading.
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

  // Memoize the UUID to prevent unnecessary re-renders
  const memoizedUUID = useMemo(() => rootUUID || '', [rootUUID]);

  return (
    <div className="story-tree-container">
      <Header 
        title="Stories"
        subtitle="View and respond to stories"
        onLogoClick={() => navigate('/feed')}
      />
      <main className="story-tree-content" role="main">
        <MemoizedVirtualizedStoryList postRootId={memoizedUUID} />
      </main>
      {replyTarget && <ReplyEditor />}
    </div>
  );
}

// New component to handle context consumption and operator setup
function StoryTreeSetupAndContent() {
  // Hooks are now called safely inside the providers
  const { state: storyTreeState, dispatch: storyTreeDispatch } = useStoryTree();
  const { state: userState } = useUser();
  const { clearReplyState } = useReplyContext();

  // Define the reset function required by the operator interface
  const resetReplyState = useCallback(() => {
    clearReplyState();
  }, [clearReplyState]);

  // Effect to initialize the operator with contexts and setters
  useEffect(() => {
    // Inject StoryTree state/dispatch
    StoryTreeOperator.setStore({ state: storyTreeState, dispatch: storyTreeDispatch });
    // Inject User context state
    StoryTreeOperator.setUserContext({ state: userState });
    // Inject Reply context setters
    StoryTreeOperator.setReplyContextSetters({ resetReplyState });


  }, [storyTreeState, storyTreeDispatch, userState, resetReplyState]);

  // Render the actual content component
  return <StoryTreeContent />;
}

// Wrapper component that renders the providers
function StoryTreeHolder() {
  const { uuid: rootUUID } = useParams<{ uuid: string }>();
  const navigate = useNavigate();

  // Initialize story tree and fetch data when rootUUID changes
  // This effect remains here as it doesn't depend on the contexts being fetched *in this component*
  useEffect(() => {
    let mounted = true;

    const initializeTree = async () => {
      if (rootUUID && mounted) {
        try {
          // We assume initializeStoryTree handles resetting state if called again
          // Operator needs contexts injected first, which happens in StoryTreeSetupAndContent
          // Ensure operator is ready before calling initialize
          // A slight delay or check might be needed if there's a race condition,
          // but usually the effect in SetupAndContent runs before this outer one triggers initialize.
          await StoryTreeOperator.initializeStoryTree(rootUUID);
        } catch (error) {
          console.error('Failed to initialize story tree:', error);
          if (mounted) {
            // Optionally navigate away or show a persistent error
            // Consider dispatching error to StoryTreeContext instead of navigating
             navigate('/feed');
          }
        }
      }
    };

    // Need to ensure operator injection happens first.
    // For simplicity now, we assume the inner effect runs first.
    // A more robust solution might involve a state flag set by the inner effect.
    initializeTree();

    return () => {
      mounted = false;
    };
  }, [rootUUID, navigate]);

  return (
    <StoryTreeProvider>
      <ReplyProvider>
        <StoryTreeSetupAndContent />
      </ReplyProvider>
    </StoryTreeProvider>
  );
}

export default StoryTreeHolder;