import React, { useEffect } from 'react';
import './PostTree.css';
import { useUser } from '../context/UserContext';
import PostTreeHolder from './PostTreeHolder';
function PostTreePage() {
  const { state } = useUser();

// (Removed the empty useEffect hook here)

  return (
    <div className="post-tree-page">
      <PostTreeHolder />
    </div>
  );
}

export default PostTreePage;
