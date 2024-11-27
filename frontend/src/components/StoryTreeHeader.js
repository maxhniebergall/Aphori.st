import React, { useState } from 'react';
import PropTypes from 'prop-types';
import './StoryTreeHeader.css';
import { useUser } from '../context/UserContext';
import AuthModal from './AuthModal'; // Import the new modal component

function StoryTreeHeader({ rootNode, onLogoClick, onMenuClick }) {
  const { state, logout, sendMagicLink } = useUser();
  const [isModalOpen, setModalOpen] = useState(false);

  const handleSignIn = async (email) => {
    console.log('Attempting to sign in with email:', email); // Add logging
    return await sendMagicLink(email);
  };

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
        <div className="header-controls">
          {state.user ? (
            <button className="profile-button" onClick={logout}>
              👤 {state.user.email}
            </button>
          ) : (
            <div className="menu-icon" onClick={() => setModalOpen(true)}>
              ☰
            </div>
          )}
        </div>
      </div>
      {rootNode && (
        <div className="story-header">
          <h1>{(rootNode.metadata?.title || 'Untitled').slice(0, 45)}</h1>
          <h2>by {rootNode.metadata?.author || 'Anonymous'}</h2>
        </div>
      )}
      <AuthModal isOpen={isModalOpen} onClose={() => setModalOpen(false)} onSignIn={handleSignIn} />
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