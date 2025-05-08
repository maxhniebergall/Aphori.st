import React, { useState } from 'react';
import './AuthModal.css';

function AuthModal({ isOpen, onClose, onSignIn }) {
    const [status, setStatus] = useState({ message: '', isError: false });
    
    if (!isOpen) return null;

    const handleSubmit = async (e) => {
        e.preventDefault();
        const email = e.target.email.value;
        setStatus({ message: 'Sending magic link...', isError: false });
        
        try {
            const result = await onSignIn(email);
            if (result.success) {
                setStatus({ message: 'Magic link sent! Please check your email.', isError: false });
                setTimeout(onClose, 3000);
            } else {
                setStatus({ message: result.error || 'Failed to send magic link', isError: true });
            }
        } catch (error) {
            console.error('Auth error:', error);
            setStatus({ message: 'An error occurred', isError: true });
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <h2>Sign In</h2>
                <form onSubmit={handleSubmit}>
                    <input
                        name="email"
                        type="email"
                        placeholder="Enter your email"
                        required
                    />
                    <button type="submit">Send Magic Link</button>
                </form>
                {status.message && (
                    <p className={status.isError ? 'error-message' : 'success-message'}>
                        {status.message}
                    </p>
                )}
                <button className="close-button" onClick={onClose}>Close</button>
            </div>
        </div>
    );
}

export default AuthModal; 