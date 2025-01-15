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
  const [replyToNodeId, setReplyToNodeId] = useState(null);
  
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
        const data = await storyTreeOperator.fetchRootNode(rootUUID);
        
        if (!data || !data.id) {
          console.error('Invalid data structure received:', data);
          return;
        }
        
        dispatch({ type: ACTIONS.SET_ROOT_NODE, payload: data });
        dispatch({ type: ACTIONS.SET_ITEMS, payload: [data] });
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

  const { rootNode } = state;
  const title = rootNode?.metadata?.title || '';
  const subtitle = rootNode?.metadata?.author ? `by ${rootNode.metadata.author}` : '';

  const handleReplySubmit = async (content) => {
    try {
      await storyTreeOperator.submitReply(replyToNodeId, content);
      setReplyToNodeId(null);
    } catch (error) {
      console.error('Error submitting reply:', error);
    }
  };

  const handleReplyClick = useCallback((nodeId) => {
    console.log('StoryTreeHolder handleReplyClick:', { nodeId, currentReplyToNodeId: replyToNodeId });
    setReplyToNodeId(current => {
      const newValue = nodeId === current ? null : nodeId;
      console.log('Setting replyToNodeId to:', newValue);
      if (newValue !== null) {
        setTimeout(() => {
          const storyTreeContent = document.querySelector('.story-tree-content');
          if (storyTreeContent) {
            storyTreeContent.scrollTo({
              top: storyTreeContent.scrollHeight,
              behavior: 'smooth'
            });
          }
        }, 100);
      }
      return newValue;
    });
  }, []);

  if (!isOperatorInitialized) {
    return <div>Loading...</div>;
  }

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
          items={state?.items ?? []}
          hasNextPage={state?.hasNextPage ?? false}
          isItemLoaded={storyTreeOperator.isItemLoaded}
          loadMoreItems={storyTreeOperator.loadMoreItems}
          fetchNode={storyTreeOperator.fetchNode}
          setIsFocused={storyTreeOperator.setCurrentFocus}
          handleSiblingChange={handleSiblingChange}
          replyToNodeId={replyToNodeId}
          onReplySubmit={handleReplySubmit}
          onReplyClick={handleReplyClick}
        />
      </div>
    </div>
  );
}

export default StoryTreeHolder; 