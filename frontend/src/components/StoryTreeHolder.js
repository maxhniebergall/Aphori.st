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
import StoryTreeOperator, { fetchRootNode } from '../operators/StoryTreeOperator';

function StoryTreeHolder() {
  return (
    <StoryTreeProvider>
      <StoryTreeContent />
    </StoryTreeProvider>
  );
}

function StoryTreeContent() {
  const { state, dispatch } = useStoryTree();
  const { rootNode, isEditing, currentNode } = state;
  const navigate = useNavigate();
  const pathParams = useParams();
  const rootUUID = pathParams.uuid;

  console.log('Path Parameters:', pathParams);
  console.log('Root UUID:', rootUUID);

  useEffect(() => {
    const initializeRootNode = async () => {
      try {
        console.log('Fetching root node for UUID:', rootUUID);
        const data = await fetchRootNode(rootUUID);
        
        // Ensure data has the required structure
        if (!data || !data.id) {
          console.error('Invalid data structure received:', data);
          return;
        }
        
        dispatch({ type: ACTIONS.SET_ROOT_NODE, payload: data });
        // Also initialize items with the root node
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
      <StoryTreeOperator />
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