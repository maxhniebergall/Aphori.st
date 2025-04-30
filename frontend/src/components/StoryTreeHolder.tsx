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
    clearReplyState
  } = useReplyContext();

  const MAX_REPLY_LENGTH = 1000;
  const MIN_REPLY_LENGTH = 50; // Define min length

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
  
  // Handle reply cancellation or successful submission
  const handleReplyFinished = useCallback(() => {
    clearReplyState(); // Call context's clear function
  }, [clearReplyState]);

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
      <div 
        style={{
          textAlign: 'left',
          fontSize: '0.8em',
          marginTop: '4px',
          color: replyContent.length < MIN_REPLY_LENGTH || replyContent.length > MAX_REPLY_LENGTH ? 'red' : 'inherit'
        }}
      >
        {replyContent.length} / {MIN_REPLY_LENGTH} (min) - {MAX_REPLY_LENGTH} (max)
      </div>
      <div className="reply-actions" role="group" aria-label="Reply actions">
        <button 
          onClick={async () => {
            // Trim content first
            const trimmedReplyContent = replyContent.trim();

            if (!trimmedReplyContent) {
              window.alert("Reply cannot be empty.");
              return; // Stop the submission
            }

            // If trimming changed the content, update the state via context
            if (trimmedReplyContent !== replyContent) {
              setReplyContent(trimmedReplyContent);
            }
            
            // Use trimmed content for length validation checks
            if (trimmedReplyContent.length > MAX_REPLY_LENGTH) {
              window.alert(`Reply text cannot exceed ${MAX_REPLY_LENGTH} characters.`);
              return; // Stop the submission
            }
            if (trimmedReplyContent.length < MIN_REPLY_LENGTH) {
              window.alert(`Reply text must be at least ${MIN_REPLY_LENGTH} characters long.`);
              return; // Stop the submission
            }

            // Ensure replyTarget and replyQuote are available before submitting
            if (!replyTarget || !replyQuote) {
              console.error("Cannot submit reply without target or quote.");
              window.alert("An error occurred. Please try restarting the reply.");
              handleReplyFinished(); // Clear state on error
              return;
            }

            try {
              const result = await StoryTreeOperator.submitReply(trimmedReplyContent, replyTarget.id, replyQuote);
              if (!result.error) {
                handleReplyFinished(); // Clear state (including localStorage) on success
              } else {
                 // Handle specific submission errors if needed, but don't clear state
                 // User might want to fix the content and retry
                 window.alert(`Failed to submit reply: ${result.error}`); 
              }
            } catch (error) {
              console.error("Error during reply submission:", error);
              window.alert("An unexpected error occurred during submission.");
              // Don't clear state here either, allow retry
            }
          }}
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
  const { replyTarget } = useReplyContext();

  // Memoize the UUID to prevent unnecessary re-renders
  const memoizedUUID = useMemo(() => rootUUID || '', [rootUUID]);

  // Header is now rendered unconditionally
  // The main content area will conditionally render error or list

  return (
    <div className="story-tree-container">
      <Header 
        title="Stories"
        subtitle="View and respond to stories"
        onLogoClick={() => navigate('/feed')}
      />
      <main className="story-tree-content" role="main">
        {state.error ? (
          // Render error UI if state.error is truthy
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
        ) : (
          // Render the story list if there is no error
          <MemoizedVirtualizedStoryList postRootId={memoizedUUID} />
        )}
      </main>
      {/* Reply editor remains conditional based on replyTarget */}
      {replyTarget && <ReplyEditor />} 
    </div>
  );
}

// New component to handle context consumption and operator setup
function StoryTreeSetupAndContent() {
  // Hooks are now called safely inside the providers
  const { state: storyTreeState, dispatch: storyTreeDispatch } = useStoryTree();
  const { state: userState } = useUser();
  const { clearReplyState, setRootUUID } = useReplyContext();
  const { uuid: rootUUIDFromParams } = useParams<{ uuid: string }>();
  const navigate = useNavigate();

  // Memoize the root UUID from params to prevent unnecessary effect runs
  const rootUUID = useMemo(() => rootUUIDFromParams || null, [rootUUIDFromParams]);

  // Define the reset function required by the operator interface
  const resetReplyState = useCallback(() => {
    clearReplyState();
  }, [clearReplyState]);

  // Effect to update rootUUID in ReplyContext when it changes
  useEffect(() => {
    setRootUUID(rootUUID);
  }, [rootUUID, setRootUUID]);

  // Effect to initialize the operator with contexts and setters
  useEffect(() => {
    // Inject StoryTree state/dispatch
    StoryTreeOperator.setStore({ state: storyTreeState, dispatch: storyTreeDispatch });
    // Inject User context state
    StoryTreeOperator.setUserContext({ state: userState });
    // Inject Reply context setters
    StoryTreeOperator.setReplyContextSetters({ resetReplyState });
  }, [storyTreeState, storyTreeDispatch, userState, resetReplyState]);

  // Effect to initialize story tree and fetch data when rootUUID changes
  useEffect(() => {
    let mounted = true;

    const initializeTree = async () => {
      if (rootUUID && mounted) {
        // Clear previous error before fetching new tree by setting payload to empty string
        storyTreeDispatch({ type: 'SET_ERROR', payload: '' }); 
        try {
          await StoryTreeOperator.initializeStoryTree(rootUUID);
        } catch (error: any) {
          console.error('Failed to initialize story tree:', error);
          if (mounted) {
            // Determine if the error is likely a 'Not Found'
            const errorMessage = error?.response?.status === 404 
              ? `Story with ID '${rootUUID}' not found.` 
              : 'It seems like this story tree does not exist.';
            // Dispatch error state to context instead of navigating
            storyTreeDispatch({ type: 'SET_ERROR', payload: errorMessage });
          }
        }
      } else if (!rootUUID && mounted) {
          // Handle case where UUID is missing in the URL path itself
          // Clear previous error first by setting payload to empty string
          storyTreeDispatch({ type: 'SET_ERROR', payload: '' }); 
          storyTreeDispatch({ type: 'SET_ERROR', payload: 'No story ID provided.' });
      }
    };

    initializeTree();

    return () => {
      mounted = false;
      // Optional: Clear error when navigating away or changing UUID by setting payload to empty string
      // storyTreeDispatch({ type: 'SET_ERROR', payload: '' });
    };
    // Ensure navigate is included if used inside effect, though it's not directly used here now.
  }, [rootUUID, storyTreeDispatch]); 


  // Render the actual content component
  return <StoryTreeContent />;
}

// Wrapper component that renders the providers
function StoryTreeHolder() {
  return (
    <StoryTreeProvider>
      <ReplyProvider>
        <StoryTreeSetupAndContent />
      </ReplyProvider>
    </StoryTreeProvider>
  );
}

export default StoryTreeHolder;