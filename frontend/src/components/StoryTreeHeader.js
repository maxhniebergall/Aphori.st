import React from 'react';
import PropTypes from 'prop-types';
import './StoryTreeHeader.css';

function StoryTreeHeader({ rootNode, onLogoClick, onMenuClick }) {
  return (
    <div className="combined-header">
      <div className="app-header">
        <div className="logo-container">
          <img 
            src="/logo.jpg"
            alt="Aphori.st Logo" 
            className="logo"
            onClick={onLogoClick}
          />
        </div>
        <div className="menu-icon" onClick={onMenuClick}>
          ☰
        </div>
      </div>
      {rootNode && (
        <div className="story-header">
          <h1>{(rootNode.metadata?.title || 'Untitled').slice(0, 45)}</h1>
          <h2>by {rootNode.metadata?.author || 'Anonymous'}</h2>
        </div>
      )}
    </div>
  );
}

StoryTreeHeader.propTypes = {
  rootNode: PropTypes.shape({
    metadata: PropTypes.shape({
      title: PropTypes.string,
      author: PropTypes.string
    })
  }),
  onLogoClick: PropTypes.func.isRequired,
  onMenuClick: PropTypes.func.isRequired
};

export default StoryTreeHeader; 