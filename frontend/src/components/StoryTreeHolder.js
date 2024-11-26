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

  useEffect(() => {
    const fetchRootNode = async () => {
      try {
        const response = await axios.get(
          `${process.env.REACT_APP_API_URL}/api/storyTree/${rootUUID}`
        );
        const data = response.data;
        dispatch({ type: ACTIONS.SET_ROOT_NODE, payload: data });
      } catch (error) {
        console.error('Error fetching story data:', error);
      }
    };

    if (rootUUID) {
      fetchRootNode();
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