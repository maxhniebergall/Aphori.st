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
        if (token) {
            verifyMagicLink(token);
        }
    }, [token, verifyMagicLink]);

    useEffect(() => {
        if (state.user) {
            navigate('/'); // Redirect to main page after verification
        }
    }, [state.user, navigate]);

    return (
        <div className="verify-magic-link">
            {state.loading && <p>Verifying your magic link...</p>}
            {state.error && <p className="error">{state.error}</p>}
        </div>
    );
}

export default VerifyMagicLink; 