import React, { useEffect } from 'react';
import StoryTreeHolder from './StoryTreeHolder';
import './StoryTree.css';
import { useUser } from '../context/UserContext';

function StoryTreePage() {
  const { state } = useUser();

  useEffect(() => {
    // Check if user is logged in
    
  }, [state?.user]);

  return (
    <div className="story-tree-page">
      <StoryTreeHolder />
    </div>
  );
}

export default StoryTreePage;
