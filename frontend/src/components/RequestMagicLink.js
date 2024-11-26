import React, { useState } from 'react';
import { useUser } from '../context/UserContext';

function RequestMagicLink() {
    const [email, setEmail] = useState('');
    const { state, sendMagicLink } = useUser();
    const [message, setMessage] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        await sendMagicLink(email);
        if (!state.error) {
            setMessage('A magic link has been sent to your email. Please check your inbox.');
        }
    };

    return (
        <div className="magic-link-container">
            <h2>Sign In with Email</h2>
            <form onSubmit={handleSubmit}>
                <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="Enter your email"
                    required
                />
                <button type="submit" disabled={state.loading}>
                    {state.loading ? 'Sending...' : 'Send Magic Link'}
                </button>
            </form>
            {message && <p className="success">{message}</p>}
            {state.error && <p className="error">{state.error}</p>}
        </div>
    );
}

export default RequestMagicLink; 