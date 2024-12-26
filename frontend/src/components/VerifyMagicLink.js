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
    const [errorMessage, setErrorMessage] = useState('');
    const [isNewUser, setIsNewUser] = useState(false);
    const [email, setEmail] = useState('');

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    
    const attemptVerification = async (retryCount = 0) => {
        try {
            const result = await verifyMagicLink(token);
            console.log("verifyMagicLink result:", result);
            
            if (result.success) {
                navigate('/feed');
                return;
            }
            
            // Check for user not found case with email in query params
            if (result.error === 'User not found' && query.get('email') && retryCount < 2) {
                console.log(`Retry attempt ${retryCount + 1} - waiting ${(retryCount + 2)}s`);
                await sleep((retryCount + 2) * 1000);
                return attemptVerification(retryCount + 1);
            }
            
            // Check for new user case (300 status)
            if (result?.result?.email) {
                console.log("Redirecting to signup with email:", result.result.email);
                setIsNewUser(true);
                setEmail(result.result.email);
                navigate(`/signup?email=${encodeURIComponent(result.result.email)}&token=${token}`);
                return;
            }

            console.log("Verification failed with result:", result);
            setVerifyFailed(true);
            setErrorMessage(result.error || 'Verification failed. Please try again.');
        } catch (error) {
            console.error('Unexpected error during verification:', error);
            setVerifyFailed(true);
            setErrorMessage('An unexpected error occurred. Please try again.');
        }
    };

    useEffect(() => {
        if (!token) {
            navigate('/login');
            return;
        }

        if (state.verified === null && !verifyFailed) {
            setIsLoading(true);
            attemptVerification()
                .finally(() => {
                    setIsLoading(false);
                });
        }
    }, [token, state.verified, verifyMagicLink, navigate, verifyFailed]);

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
                {verifyFailed && !isNewUser && (
                    <div>
                        <p style={{ color: 'red' }}>{errorMessage}</p>
                        <button 
                            onClick={() => navigate('/login')}
                            style={{
                                padding: '10px 20px',
                                marginTop: '10px',
                                marginRight: '10px',
                                cursor: 'pointer'
                            }}
                        >
                            Back to Login
                        </button>
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
                {verifyFailed && isNewUser && (
                    <div>
                        <button 
                            onClick={() => navigate(`/signup?email=${encodeURIComponent(email)}&token=${token}`)}
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