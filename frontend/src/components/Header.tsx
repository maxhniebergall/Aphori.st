import React, { useState } from 'react';
// import PropTypes from 'prop-types'; // PropTypes are not needed with TypeScript
import './Header.css';
import { useUser } from '../context/UserContext';
import AuthModal from './AuthModal';
import { HeaderProps } from '../types/userAuth';

function Header({ onLogoClick }: HeaderProps) {
  const { state, logout, sendMagicLink } = useUser();
  const [isModalOpen, setModalOpen] = useState(false);
  const [isAuthModalOpen, setAuthModalOpen] = useState(false);

  const handleSignIn = async (email: string): Promise<{ success: boolean; error?: string }> => {
    // Attempt to sign in
    try {
      await sendMagicLink(email); // Call the method from context
      return { success: true }; // Return success structure
    } catch (error: any) {
      console.error('Error sending magic link:', error);
      const errorMessage = error?.message || 'Failed to send magic link. Please try again later.';
      return { success: false, error: errorMessage }; // Return error structure
    }
  };

  const toggleMenu = () => {
    setModalOpen(!isModalOpen);
  };

  return (
    <div className="combined-header">
      <div className="app-header" style={isModalOpen ? {} : {borderBottom: '1px solid #e0e0e0'}}>
        <div className="logo-container">
          <img 
            src="/logo.jpg"
            alt="Aphori.st Logo" 
            className="logo"
            onClick={onLogoClick}
          />
        </div>
        <div className="header-controls">
          {state?.user?.id && state.verified ? (
            <button className="profile-button" onClick={toggleMenu}>
              👤 {state.user.id}
            </button>
          ) : (
            <div className="menu-icon" onClick={toggleMenu}>
              {isModalOpen ? '✕' : '☰'}
            </div>
          )}
        </div>
      </div>
      
      {isModalOpen && (
            <div className="header-menu-modal">
                {/* Show user info if verified */}
                {state?.verified && state?.user?.id && (
                    <div className="signed-in-user-info">
                      <form action="/post">
                        <button className='post-button'> Make a Post </button>
                      </form>
                        <button className="sign-in-button" onClick={logout}>Sign Out</button>
                    </div>
                )}

                {/* Show auth modal or sign in button if not verified */}
                {!state?.verified && (
                    <>
                        {isAuthModalOpen ? (
                            <AuthModal isOpen={isModalOpen} onClose={() => setAuthModalOpen(false)} onSignIn={handleSignIn} />
                        ) : (
                            <button className="sign-in-button" onClick={() => setAuthModalOpen(true)}>Sign In</button>
                        )}
                    </>
                )}

                {/* Report bug button always visible when modal is open */}
                <a className="report-bug-button" href="https://github.com/maxhniebergall/Aphori.st/issues">Report a Bug</a>
              </div>
        )}

    </div>
  );
}

// Header.propTypes = {
//   title: PropTypes.string,
//   subtitle: PropTypes.string,
//   onLogoClick: PropTypes.func.isRequired
// };

export default Header; 