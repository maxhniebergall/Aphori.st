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
 * - @uiw/react-md-editor: For markdown editing and preview
 * - @uiw/react-md-editor/markdown-editor.css: Required CSS for markdown editor
 * - rehype-sanitize: For markdown sanitization
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import './StoryTree.css';
import Header from './Header';
import { 
  StoryTreeProvider, 
  useStoryTree,   
  ACTIONS,
} from '../context/StoryTreeContext';
import VirtualizedStoryList from './VirtualizedStoryList';
import { storyTreeOperator } from '../operators/StoryTreeOperator';
import { useSiblingNavigation } from '../hooks/useSiblingNavigation';
import MDEditor from '@uiw/react-md-editor';
import '@uiw/react-md-editor/markdown-editor.css';
import rehypeSanitize from 'rehype-sanitize';

function StoryTreeHolder() {
  return (
    <StoryTreeProvider>
      <StoryTreeContent />
    </StoryTreeProvider>
  );
}

function StoryTreeContent() {
  const navigate = useNavigate();
  const pathParams = useParams();
  const rootUUID = pathParams.uuid;
  const { handleSiblingChange } = useSiblingNavigation();
  const { state, dispatch } = useStoryTree();
  const [isOperatorInitialized, setIsOperatorInitialized] = useState(false);
  const [replyContent, setReplyContent] = useState('');
  const [replyTarget, setReplyTarget] = useState(null);
  const [selectionState, setSelectionState] = useState(null);
  
  useEffect(() => {
    if (state && dispatch) {
      storyTreeOperator.updateContext(state, dispatch);
      setIsOperatorInitialized(true);
    }
  }, [state, dispatch]);

  useEffect(() => {
    const initializeRootNode = async () => {
      if (!isOperatorInitialized) return;

      try {
        const allNodes = await storyTreeOperator.fetchRootNode(rootUUID);
        
        if (!allNodes || allNodes.length === 0) {
          console.error('Invalid data structure received:', allNodes);
          return;
        }
        
        const rootNode = allNodes.find(node => node.id === rootUUID);
        if (!rootNode) {
          console.error('Root node not found in fetched nodes:', allNodes);
          return;
        }

        dispatch({ type: ACTIONS.SET_ROOT_NODE, payload: rootNode });
        dispatch({ type: ACTIONS.SET_ITEMS, payload: allNodes });
      } catch (error) {
        console.error('Error fetching story data:', error);
      }
    };

    if (rootUUID) {
      initializeRootNode();
    } else {
      console.warn('No rootUUID provided');
    }
  }, [rootUUID, dispatch, isOperatorInitialized]);

  const handleReplySubmit = useCallback(async () => {
    if (!replyTarget || !selectionState) return;

    try {
      const selectedText = replyTarget.text.slice(selectionState.start, selectionState.end);
      const result = await storyTreeOperator.submitReply(
        replyTarget.id,
        replyContent,
        {
          quote: selectedText,
          sourcePostId: replyTarget.id,
          selectionRange: selectionState
        }
      );
      if (result) {
        setReplyContent('');
        setReplyTarget(null);
        setSelectionState(null);
      }
    } catch (error) {
      console.error('Error submitting reply:', error);
    }
  }, [replyTarget, selectionState, replyContent]);

  const handleReplyCancel = useCallback(() => {
    setReplyContent('');
    setReplyTarget(null);
    setSelectionState(null);
  }, []);

  const handleNodeReply = useCallback((node, selection) => {
    setReplyTarget(node);
    setSelectionState(selection);
  }, []);

  const { rootNode } = state;
  const title = rootNode?.metadata?.title || '';
  const subtitle = rootNode?.metadata?.author ? `by ${rootNode.metadata.author}` : '';

  if (!isOperatorInitialized) {
    return <div>Loading...</div>;
  }

  const renderReplyEditor = () => {
    if (!replyTarget || !selectionState) return null;

    const selectedText = replyTarget.text.slice(selectionState.start, selectionState.end);
    console.log("selectedText", selectedText);
    return (
      <div className="reply-editor-container">
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
            onClick={handleReplySubmit}
            disabled={!replyContent.trim()}
            className="submit-reply-button"
          >
            Submit
          </button>
          <button 
            onClick={handleReplyCancel}
            className="cancel-reply-button"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="story-tree-container">
      <div className="story-tree-header">
        <Header 
          onLogoClick={() => navigate('/feed')}
        />
      </div>
      <div className="story-tree-content">
        <div className="story-title-section">
          <h1>{title}</h1>
          {subtitle && <h2 className="story-subtitle">{subtitle}</h2>}
        </div>
        <VirtualizedStoryList
          postRootId={rootUUID}
          items={state?.items ?? []}
          hasNextPage={state?.hasNextPage ?? false}
          isItemLoaded={storyTreeOperator.isItemLoaded}
          loadMoreItems={storyTreeOperator.loadMoreItems}
          fetchNode={storyTreeOperator.fetchNode}
          setIsFocused={storyTreeOperator.setCurrentFocus}
          handleSiblingChange={handleSiblingChange}
          onNodeReply={handleNodeReply}
          replyTarget={replyTarget}
        />
        {renderReplyEditor()}
      </div>
    </div>
  );
}

export default StoryTreeHolder; 