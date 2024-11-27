import React, { useEffect, useState } from 'react';
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
    const [verified, setVerified] = useState(null);

    useEffect(() => {
        if (token && verified === null) {
            verifyMagicLink(token)
                .then(result => {
                    if (result.success) {
                        setVerified(true);
                    } else {
                        setVerified(false);
                    }
                })
                .catch(error => {
                    console.error('Magic link verification error:', error);
                    setVerified(false);
                });
        }
    }, [token]);

    useEffect(() => {
        if (state.user) {
            navigate('/feed');
        }
    }, [state.user, navigate]);

    return (
        <div className="verify-magic-link">
            {state.loading && <p>Verifying your magic link...</p>}
            {state.error && <p className="error">{state.error}</p>}
            {verified === false && (
                <div>
                    <p className="error">This magic link is invalid or has expired. Please request a new one.</p>
                    <button onClick={() => navigate('/login')}>Go to Login</button>
                </div>
            )}
        </div>
    );
}

export default VerifyMagicLink; 