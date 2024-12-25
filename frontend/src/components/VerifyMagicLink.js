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
    const [verifyFailed, setVerifyFailed] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (!token) {
            navigate('/login');
            return;
        }

        if (state.verified === null && !verifyFailed) {
            setIsLoading(true);
            verifyMagicLink(token)
                .then(result => {
                    if (result.status === 300 && result.data.error === 'User not found') {
                        navigate(`/signup?email=${encodeURIComponent(result.data.email)}&token=${token}`);
                    }
                    if (!result.success) {
                        setVerifyFailed(true);
                    }
                })
                .catch(error => {
                    console.error('Magic link verification error:', error);
                    setVerifyFailed(true);
                })
                .finally(() => {
                    setIsLoading(false);
                });
        }
    }, [token, state.verified, verifyMagicLink, navigate, verifyFailed]);

    useEffect(() => {
        if (state.user) {
            navigate('/feed');
        }
    }, [state.user, navigate]);

    return (
        <div className="verify-magic-link" style={{ 
            display: 'flex', 
            justifyContent: 'center', 
            alignItems: 'center', 
            minHeight: '100vh',
            padding: '20px'
        }}>
            <div style={{ textAlign: 'center' }}>
                {!token && <p>No verification token provided.</p>}
                {isLoading && <p>Verifying your magic link...</p>}
                {verifyFailed && (
                    <div>
                        <p style={{ color: 'red' }}>This magic link is invalid or has expired. Please request a new one.</p>
                        <button 
                            onClick={() => navigate('/signup')}
                            style={{
                                padding: '10px 20px',
                                marginTop: '10px',
                                cursor: 'pointer'
                            }}
                        >
                            Go to Signup
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

export default VerifyMagicLink; 