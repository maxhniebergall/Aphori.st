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
 * - lodash/debounce: For performance optimization
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
import { ReplyProvider, useReplyContext } from '../context/ReplyContext';

function StoryTreeHolder() {
  return (
    <StoryTreeProvider>
      <ReplyProvider>
        <StoryTreeContent />
      </ReplyProvider>
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
  const { 
    replyTarget, 
    setReplyTarget,
    replyContent,
    setReplyContent,
    selectionState,
    setSelectionState 
  } = useReplyContext();
  
  useEffect(() => {
    let mounted = true;
    
    const initialize = async () => {
      if (!state || !dispatch) return;
      
      storyTreeOperator.updateContext(state, dispatch);
      setIsOperatorInitialized(true);
      
      if (!rootUUID) {
        console.warn('No rootUUID provided');
        return;
      }
      
      dispatch({ type: ACTIONS.SET_LOADING_STATE, payload: 'LOADING' });
      
      try {
        const allNodes = await storyTreeOperator.fetchRootNodeWithIncludedNodes(rootUUID);
        
        if (!mounted) return;
        
        if (!allNodes || allNodes.length === 0) {
          console.error('Invalid data structure received:', allNodes);
          dispatch({ type: ACTIONS.SET_LOADING_STATE, payload: 'ERROR' });
          return;
        }
        
        const rootNode = allNodes.find(node => node.storyTree?.id === rootUUID);
        if (!rootNode) {
          console.error('Root node not found in fetched nodes:', allNodes);
          dispatch({ type: ACTIONS.SET_LOADING_STATE, payload: 'ERROR' });
          return;
        }

        // Batch state updates
        dispatch({
          type: ACTIONS.INITIALIZE_STORY_TREE,
          payload: {
            rootNode,
            nodes: allNodes,
            loadingState: 'SUCCESS',
            hasNextPage: rootNode.storyTree?.nodes?.some(node => node?.id)
          }
        });
        
      } catch (error) {
        if (mounted) {
          console.error('Error fetching story data:', error);
          dispatch({ type: ACTIONS.SET_LOADING_STATE, payload: 'ERROR' });
        }
      }
    };

    initialize();
    
    return () => {
      mounted = false;
    };
  }, [rootUUID, state, dispatch]);

  const handleReplySubmit = useCallback(async () => {
    if (!replyTarget || !selectionState) return;

    try {
      const quoteData = selectionState ? {
        quote: replyTarget.storyTree.text.slice(selectionState.start, selectionState.end),
        sourcePostId: replyTarget.storyTree.id,
        selectionRange: selectionState
      } : {
        quote: replyTarget.storyTree.text,
        sourcePostId: replyTarget.storyTree.id,
        selectionRange: {
          start: 0,
          end: replyTarget.storyTree.text.length
        }
      };

      const result = await storyTreeOperator.submitReply(
        replyTarget.storyTree.id,
        replyContent,
        quoteData
      );
      
      if (result) {
        setReplyContent('');
        setReplyTarget(null);
        setSelectionState(null);
      }
    } catch (error) {
      console.error('Error submitting reply:', error);
    }
  }, [replyTarget, selectionState, replyContent, setReplyContent, setReplyTarget, setSelectionState]);

  const handleReplyCancel = useCallback(() => {
    setReplyContent('');
    setReplyTarget(null);
    setSelectionState(null);
  }, [setReplyContent, setReplyTarget, setSelectionState]);

  if (!isOperatorInitialized) {
    return <div>Loading...</div>;
  }

  const renderReplyEditor = () => {
    if (!replyTarget || !selectionState) {
      return null;
    }

    const selectedText = replyTarget.storyTree.text.slice(selectionState.start, selectionState.end);
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
        <VirtualizedStoryList
          postRootId={rootUUID}
          nodes={state?.nodes ?? []}
          hasNextPage={state?.hasNextPage ?? false}
          isItemLoaded={storyTreeOperator.isItemLoaded}
          loadMoreItems={storyTreeOperator.loadMoreItems}
          fetchNode={storyTreeOperator.fetchNode}
          setIsFocused={storyTreeOperator.setCurrentFocus}
          handleSiblingChange={handleSiblingChange}
        />
        {renderReplyEditor()}
      </div>
    </div>
  );
}

export default StoryTreeHolder;