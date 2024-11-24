import React from 'react';
import { useNavigate } from 'react-router-dom';
import StoryTreeRootNode from './StoryTreeRootNode';
import './StoryTree.css';

function StoryTreePage() {
  const navigate = useNavigate();

  const handleLogoClick = () => {
    navigate('/feed');
  };

  const handleMenuClick = () => {
    // TODO: Implement menu opening logic
    console.log('Menu clicked');
  };

  return (
    <>
      <header className="app-header">
        <img 
          src="/logo.jpg" // Make sure to add your logo file to the public folder
          alt="Aphorist Logo" 
          className="logo"
          onClick={handleLogoClick}
        />
        <div className="menu-icon" onClick={handleMenuClick}>
          ☰
        </div>
      </header>
      <StoryTreeRootNode />
    </>
  );
}

export default StoryTreePage;
