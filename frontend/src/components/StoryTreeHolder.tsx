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

// Main content component
function StoryTreeContent() {
  const navigate = useNavigate();
  const { state } = useStoryTree();
  const [isRootInitialized, setIsRootInitialized] = useState(false);
  // Get the UUID from the URL
  const { uuid: rootUUID } = useParams<{ uuid: string }>();
 
  const { 
    replyTarget, 
    setReplyTarget,
    replyContent,
    setReplyContent,
    replyQuote,
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
  
  // Initialize story tree and fetch data
  useEffect(() => {
    let mounted = true;

    const initializeTree = async () => {
      if (!isRootInitialized && rootUUID && mounted) {
        try {
          await StoryTreeOperator.initializeStoryTree(rootUUID);
          if (mounted) {
            setIsRootInitialized(true);
          }
        } catch (error) {
          console.error('Failed to initialize story tree:', error);
          if (mounted) {
            navigate('/feed');
          }
        }
      }
    };

    initializeTree();

    return () => {
      mounted = false;
    };
  }, [isRootInitialized, rootUUID, navigate]);

  // Handle reply cancellation
  const handleReplyCancel = useCallback(() => {
    setReplyContent('');
    setReplyTarget(null);
    setReplyQuote(null);
  }, [setReplyContent, setReplyTarget, setReplyQuote]);

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

  // Render reply editor
  const renderReplyEditor = () => {
    if (!replyTarget || !replyQuote) {
      console.error('Reply target or quote is not set, ' + replyTarget + ' ' + replyQuote);
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
            onClick={() => StoryTreeOperator.submitReply(replyTarget.rootNodeId, replyContent, replyQuote)}
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

  return (
    <div className="story-tree-container">
      <Header 
        title="Story Tree"
        subtitle="View and reply to stories"
        onLogoClick={() => navigate('/feed')}
      />
      <main className="story-tree-content" role="main">
        <VirtualizedStoryList postRootId={rootUUID || ''} />
      </main>
      {replyTarget && renderReplyEditor()}
    </div>
  );
}

// Wrapper component with provider
function StoryTreeHolder() {
  return (
    <StoryTreeProvider>
      <ReplyProvider>
        <StoryTreeContent />
      </ReplyProvider>
    </StoryTreeProvider>
  );
}

export default StoryTreeHolder;