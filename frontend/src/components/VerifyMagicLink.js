import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useUser } from '../context/UserContext';

function useQuery() {
    return new URLSearchParams(useLocation().search);
}

function VerifyMagicLink() {
    const query = useQuery();
    const navigate = useNavigate();
    const { verifyMagicLink, state } = useUser();
    const token = query.get('token');

    useEffect(() => {
        if (token && state.verified === null) {
            verifyMagicLink(token)
                .catch(error => {
                    console.error('Magic link verification error:', error);
                });
        }
    }, [token, state.verified, verifyMagicLink]);

    useEffect(() => {
        if (state.user) {
            navigate('/feed');
        }
    }, [state.user, navigate]);

    return (
        <div className="verify-magic-link">
            {state.loading && <p>Verifying your magic link...</p>}
            {state.error && <p className="error">{state.error}</p>}
            {state.verified === false && (
                <div>
                    <p className="error">This magic link is invalid or has expired. Please request a new one.</p>
                    <button onClick={() => navigate('/login')}>Go to Login</button>
                </div>
            )}
        </div>
    );
}

export default VerifyMagicLink; 