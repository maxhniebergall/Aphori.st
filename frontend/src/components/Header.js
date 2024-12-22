import React, { useState } from 'react';
import PropTypes from 'prop-types';
import './Header.css';
import { useUser } from '../context/UserContext';
import AuthModal from './AuthModal';

function Header({ title, subtitle, onLogoClick }) {
  const { state, logout, sendMagicLink } = useUser();
  const [isModalOpen, setModalOpen] = useState(false);

  const handleSignIn = async (email) => {
    console.log('Attempting to sign in with email:', email);
    return await sendMagicLink(email);
  };

  const toggleMenu = () => {
    setModalOpen(!isModalOpen);
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
            <div className="menu-icon" onClick={toggleMenu}>
              {isModalOpen ? '✕' : '☰'}
            </div>
          )}
        </div>
      </div>
      {(title || subtitle) && (
        <div className="page-header">
          {title && <h1>{title}</h1>}
          {subtitle && <h2>{subtitle}</h2>}
        </div>
      )}
      <AuthModal isOpen={isModalOpen} onClose={toggleMenu} onSignIn={handleSignIn} />
    </div>
  );
}

Header.propTypes = {
  title: PropTypes.string,
  subtitle: PropTypes.string,
  onLogoClick: PropTypes.func.isRequired
};

export default Header; 