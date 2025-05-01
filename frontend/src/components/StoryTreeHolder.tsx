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
import { ReplyProvider, useReplyContext } from '../context/ReplyContext';
import StoryTreeOperator from '../operators/StoryTreeOperator';
import React from 'react';
import { useUser } from '../context/UserContext';
import ReplyEditor from './ReplyEditor';

// Memoized content component to prevent unnecessary re-renders
const MemoizedVirtualizedStoryList = React.memo(VirtualizedStoryList);

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