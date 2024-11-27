import React from 'react';
import StoryTreeHolder from './StoryTreeHolder';
import './StoryTree.css';
import { useUser } from '../context/UserContext';

function StoryTreePage() {
  const { verifyToken, state } = useUser();
  console.log("user is logged in:", state?.user?.email);

  return (
    <>
      <StoryTreeHolder />
    </>
  );
}

export default StoryTreePage;
