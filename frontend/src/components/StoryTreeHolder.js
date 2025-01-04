import React, { useEffect, useState } from 'react';
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
  
  // Update the operator's context whenever state or dispatch changes
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
        console.log('Fetching root node for UUID:', rootUUID);
        const data = await storyTreeOperator.fetchRootNode(rootUUID);
        
        if (!data || !data.id) {
          console.error('Invalid data structure received:', data);
          return;
        }
        console.log('Root node data:', data);
        
        dispatch({ type: ACTIONS.SET_ROOT_NODE, payload: data });
        dispatch({ type: ACTIONS.SET_ITEMS, payload: [data] });
      } catch (error) {
        console.error('Error fetching story data:', error);
      }
    };

    if (rootUUID) {
      console.log('Initializing root node for UUID');
      initializeRootNode();
    } else {
      console.warn('No rootUUID provided');
    }
  }, [rootUUID, dispatch, isOperatorInitialized]);

  const { rootNode } = state;
  const title = rootNode?.metadata?.title || '';
  const subtitle = rootNode?.metadata?.author ? `by ${rootNode.metadata.author}` : '';

  if (!isOperatorInitialized) {
    return <div>Loading...</div>;
  }

  return (
    <div className="story-tree-container">
      <Header 
        title={title}
        subtitle={subtitle}
        onLogoClick={() => navigate('/feed')}
      />
      <VirtualizedStoryList
        items={state?.items ?? []}
        hasNextPage={state?.hasNextPage ?? false}
        isItemLoaded={storyTreeOperator.isItemLoaded}
        loadMoreItems={storyTreeOperator.loadMoreItems}
        fetchNode={storyTreeOperator.fetchNode}
        setIsFocused={storyTreeOperator.setCurrentFocus}
        handleSiblingChange={handleSiblingChange}
      />      
    </div>
  );
}

export default StoryTreeHolder; 