import React, { useState } from 'react';
import { useUser } from '../context/UserContext';
import { useLocation, useNavigate } from 'react-router-dom';
import Header from './Header';
import './RequestMagicLink.css';

function RequestMagicLink() {
    const [email, setEmail] = useState('');
    const { state, sendMagicLink } = useUser();
    const [message, setMessage] = useState('');
    const location = useLocation();
    const navigate = useNavigate();
    const isSignup = location.pathname === '/signup';

    const handleSubmit = async (e) => {
        e.preventDefault();
        await sendMagicLink(email, isSignup);
        if (!state.error) {
            setMessage(`A magic link has been sent to your email. Please check your inbox to ${isSignup ? 'complete signup' : 'sign in'}.`);
        }
    };

    return (
        <>
            <Header 
                title=""
                onLogoClick={() => navigate('/feed')}
            />
            <div className="magic-link-container">
                <div className="magic-link-form-container">
                    <h2 className="magic-link-title">{isSignup ? 'Sign Up with Email' : 'Sign In with Email'}</h2>
                    <form onSubmit={handleSubmit}>
                        <input
                            type="email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            placeholder="Enter your email"
                            required
                        />
                        <button type="submit" disabled={state.loading}>
                            {state.loading ? 'Sending...' : `Send Magic Link to ${isSignup ? 'Sign Up' : 'Sign In'}`}
                        </button>
                    </form>
                    {message && <p className="success">{message}</p>}
                    {state.error && <p className="error">{state.error}</p>}
                </div>
            </div>
        </>
    );
}

export default RequestMagicLink; 