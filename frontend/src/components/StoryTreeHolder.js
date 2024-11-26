import React, { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import EditingOverlay from './EditingOverlay';
import './StoryTree.css';
import StoryTreeHeader from './StoryTreeHeader';
import { 
  StoryTreeProvider, 
  useStoryTree, 
  ACTIONS,
} from '../context/StoryTreeContext';
import StoryTreeOperator from './StoryTreeOperator';

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
    const fetchRootNode = async () => {
      try {
        console.log('Fetching root node for UUID:', rootUUID);
        const response = await axios.get(
          `${process.env.REACT_APP_API_URL}/api/storyTree/${rootUUID}`
        );
        const data = response.data;
        console.log('API Response:', data);
        
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
      fetchRootNode();
    } else {
      console.warn('No rootUUID provided');
    }
  }, [rootUUID, dispatch]);

  return (
    <div className="story-tree-container">
      <StoryTreeHeader 
        rootNode={rootNode}
        onLogoClick={() => navigate('/feed')}
        onMenuClick={() => console.log('Menu clicked')}
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