/**
 * Requirements:
 * - React, useCallback - For component rendering and memoization
 * - Display post tree with virtualized list via VirtualizedPostList (which now handles progressive loading)
 * - Handle root node initialization and data fetching (delegated to context and postTreeOperator)
 * - Properly size content accounting for header height
 * - Support sibling navigation
 * - Error handling for invalid root nodes
 * - **Simplified loading state management:** rely on VirtualizedPostList for progressive loading (global loading indicator removed)
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

import React, { useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import './PostTree.css';
import Header from './Header';
import { PostTreeProvider, usePostTree } from '../context/PostTreeContext';
import VirtualizedPostList, { VirtualizedPostListRef } from './VirtualizedPostList';
import { ReplyProvider, useReplyContext } from '../context/ReplyContext';
import PostTreeOperator from '../operators/PostTreeOperator';
import { useUser } from '../context/UserContext';
import ReplyEditor from './ReplyEditor';


// Main content component
function PostTreeContent() {
  const navigate = useNavigate();
  const { state } = usePostTree();
  const { uuid: rootUUID, replyId } = useParams<{ uuid: string; replyId?: string }>();
  const { replyTarget } = useReplyContext();
  const virtualizedListRef = useRef<VirtualizedPostListRef>(null);

  // Memoize the UUID to prevent unnecessary re-renders
  const memoizedUUID = useMemo(() => rootUUID || '', [rootUUID]);
  const memoizedReplyId = useMemo(() => replyId, [replyId]);

  // Effect to scroll to reply when tree is loaded and replyId is present
  useEffect(() => {
    if (memoizedReplyId && state.postTree && state.postTree.levels && state.postTree.levels.length > 0 && !state.isLoadingMore) {
      // Use a small delay to ensure the list is rendered
      const timeoutId = setTimeout(() => {
        if (virtualizedListRef.current) {
          virtualizedListRef.current.scrollToItem(memoizedReplyId);
        }
      }, 100);
      
      return () => clearTimeout(timeoutId);
    }
  }, [memoizedReplyId, state.postTree, state.isLoadingMore]);

  // Header is now rendered unconditionally
  // The main content area will conditionally render error or list

  return (
    <div className="post-tree-container">
      <Header onLogoClick={() => navigate('/feed')}
      />
      <main className="post-tree-content" role="main">
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
          // Render the post list if there is no error
          <VirtualizedPostList ref={virtualizedListRef} postRootId={memoizedUUID} />
        )}
      </main>
      {/* Reply editor remains conditional based on replyTarget */}
      {replyTarget && <ReplyEditor />} 
    </div>
  );
}

// New component to handle context consumption and operator setup
function PostTreeSetupAndContent() {
  // Hooks are now called safely inside the providers
  const { state: postTreeState, dispatch: postTreeDispatch } = usePostTree();
  const { state: userState } = useUser();
  const { clearReplyState, setRootUUID } = useReplyContext();
  const { uuid: rootUUIDFromParams } = useParams<{ uuid: string; replyId?: string }>();

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
    // Inject PostTree state/dispatch
    PostTreeOperator.setStore({ state: postTreeState, dispatch: postTreeDispatch });
    // Inject User context state
    PostTreeOperator.setUserContext({ state: userState });
    // Inject Reply context setters
    PostTreeOperator.setReplyContextSetters({ resetReplyState });
  }, [postTreeState, postTreeDispatch, userState, resetReplyState]);

  // Effect to initialize post tree and fetch data when rootUUID changes
  useEffect(() => {
    let mounted = true;

    const initializeTree = async () => {
      if (rootUUID && mounted) {
        // Clear previous error before fetching new tree by setting payload to empty string
        postTreeDispatch({ type: 'SET_ERROR', payload: '' }); 
        try {
          await PostTreeOperator.initializePostTree(rootUUID);
        } catch (error: any) {
          console.error('Failed to initialize post tree:', error);
          if (mounted) {
            // Determine if the error is likely a 'Not Found'
            const errorMessage = error?.response?.status === 404 
              ? `Post with ID '${rootUUID}' not found.` 
              : 'It seems like this post tree does not exist.';
            // Dispatch error state to context instead of navigating
            postTreeDispatch({ type: 'SET_ERROR', payload: errorMessage });
          }
        }
      } else if (!rootUUID && mounted) {
          // Handle case where UUID is missing in the URL path itself
          // Clear previous error first by setting payload to empty string
          postTreeDispatch({ type: 'SET_ERROR', payload: '' }); 
          postTreeDispatch({ type: 'SET_ERROR', payload: 'No post ID provided.' });
      }
    };

    initializeTree();

    return () => {
      mounted = false;
      // Optional: Clear error when navigating away or changing UUID by setting payload to empty string
      // postTreeDispatch({ type: 'SET_ERROR', payload: '' });
    };
    // Ensure navigate is included if used inside effect, though it's not directly used here now.
  }, [rootUUID, postTreeDispatch]); 


  // Render the actual content component
  return <PostTreeContent />;
}

// Wrapper component that renders the providers
function PostTreeHolder() {
  return (
    <PostTreeProvider>
      <ReplyProvider>
        <PostTreeSetupAndContent />
      </ReplyProvider>
    </PostTreeProvider>
  );
}

export default PostTreeHolder;