import React, { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import EditingOverlay from './EditingOverlay';
import './StoryTree.css';
import Header from './Header';
import { 
  StoryTreeProvider, 
  useStoryTree, 
  ACTIONS,
} from '../context/StoryTreeContext';
import VirtualizedStoryList from './VirtualizedStoryList';
import StoryTreeOperator from '../operators/StoryTreeOperator';
import { useSiblingNavigation } from '../hooks/useSiblingNavigation';
function StoryTreeHolder() {
  return (
    <StoryTreeProvider>
      <StoryTreeContent />
    </StoryTreeProvider>
  );
}

function StoryTreeContent() {
  const { state, dispatch } = useStoryTree();
  const storyTreeOperator = new StoryTreeOperator(state, dispatch);
  const { rootNode, isEditing, currentNode } = state;
  const navigate = useNavigate();
  const pathParams = useParams();
  const rootUUID = pathParams.uuid;
  const { handleSiblingChange } = useSiblingNavigation();

  console.log('Path Parameters:', pathParams);
  console.log('Root UUID:', rootUUID);

  useEffect(() => {
    const initializeRootNode = async () => {
      try {
        console.log('Fetching root node for UUID:', rootUUID);
        const data = await storyTreeOperator.fetchRootNode(rootUUID);
        
        // Ensure data has the required structure
        if (!data || !data.id) {
          console.error('Invalid data structure received:', data);
          return;
        }
        console.log('Root node data:', data);
        
        dispatch({ type: ACTIONS.SET_ROOT_NODE, payload: data });
        // Also initialize items with the root node
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
  }, [rootUUID, dispatch]);

  const title = rootNode?.metadata?.title || '';
  const subtitle = rootNode?.metadata?.author ? `by ${rootNode.metadata.author}` : '';

  return (
    <div className="story-tree-container">
      <Header 
        title={title}
        subtitle={subtitle}
        onLogoClick={() => navigate('/feed')}
      />
      <VirtualizedStoryList
        items={state?.items || []}
        hasNextPage={state?.hasNextPage || false}
        isItemLoaded={storyTreeOperator.isItemLoaded}
        loadMoreItems={storyTreeOperator.loadMoreItems}
        fetchNode={storyTreeOperator.fetchNode}
        setIsFocused={storyTreeOperator.setCurrentFocus}
        handleSiblingChange={handleSiblingChange}
      />      
      {isEditing && (
        <EditingOverlay
          node={currentNode}
          onClose={() => dispatch({ type: ACTIONS.SET_EDITING, payload: false })}
        />
      )}
    </div>
  );
}

export default StoryTreeHolder; 