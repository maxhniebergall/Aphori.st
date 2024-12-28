import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate, useLocation } from 'react-router-dom';
import { useUser } from '../context/UserContext';
import Header from './Header';
import './SignupPage.css';

function useQuery() {
    return new URLSearchParams(useLocation().search);
}

const SignupPage = () => {
    const [userId, setUserId] = useState('');
    const [email, setEmail] = useState('');
    const [isChecking, setIsChecking] = useState(false);
    const [error, setError] = useState('');
    const [agreedToTerms, setAgreedToTerms] = useState(false);
    const navigate = useNavigate();
    const query = useQuery();
    const verificationToken = query.get('token');
    const { state } = useUser();
    
    useEffect(() => {
        const emailFromUrl = query.get('email');
        if (emailFromUrl) {
            setEmail(decodeURIComponent(emailFromUrl));
        }
    }, []);

    const checkIdAvailability = async (id) => {
        try {
            setIsChecking(true);
            setError('');
            const response = await axios.get(`/api/check-user-id/${id}`);
            if (!response.data.success) {
                setError(response.data.error);
                return false;
            }
            return response.data.available;
        } catch (error) {
            setError('Error checking ID availability');
            return false;
        } finally {
            setIsChecking(false);
        }
    };

    const handleIdChange = async (e) => {
        const newId = e.target.value;
        setUserId(newId);
        
        if (newId.length >= 3) {
            const isAvailable = await checkIdAvailability(newId);
            if (!isAvailable) {
                setError('This ID is already taken');
            }
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!userId || !agreedToTerms) {
            setError('Please fill in all fields and agree to Terms & Conditions');
            return;
        }

        const isAvailable = await checkIdAvailability(userId);
        if (!isAvailable) {
            setError('This ID is already taken');
            return;
        }

        try {
            if (state.verified != true){

                setIsChecking(true);
                const payload = {
                    id: userId,
                    email: email || 'placeholder@temp.com'
                };
                
                // If we have a verification token, include it in the request
                if (verificationToken) {
                    payload.verificationToken = verificationToken;
                }

                const response = await axios.post(`${process.env.REACT_APP_API_URL}/api/signup`, payload);

                if (!response.data.success) {
                    setError(response.data.error);
                    return;
                }

                // Redirect to login page for magic link authentication 
                navigate(`/verify?token=${verificationToken}`, { 
                    state: { 
                        message: 'Account created successfully! You will be automatically logged in.',
                        userId 
                    } 
                });
            }
        } catch (error) {
            setError(error.response?.data?.error || 'Error creating account');
        } finally {
            setIsChecking(false);
        }
    };

    return (
        <>
            <Header 
                title=""
                onLogoClick={() => navigate('/feed')}
            />
            <div className="signup-container">
                <div className="signup-form-container">
                    <h1 className="signup-title">Sign Up</h1>
                    <form onSubmit={handleSubmit}>
                        <div className="mb-4">
                            <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="userId">
                                Choose your ID
                            </label>
                            <input
                                type="text"
                                id="userId"
                                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:border-blue-500"
                                value={userId}
                                onChange={handleIdChange}
                                minLength={3}
                                required
                            />
                            {isChecking && <p className="text-gray-500 text-sm mt-1">Checking availability...</p>}
                            {error && <p className="text-red-500 text-sm mt-1">{error}</p>}
                        </div>

                        <div className="mb-4">
                            <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="email">
                                Email
                            </label>
                            <input
                                type="email"
                                id="email"
                                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:border-blue-500 ${query.get('email') ? 'bg-gray-100' : ''}`}
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                readOnly={!!query.get('email')}
                                required
                            />
                        </div>

                        <div className="mb-6">
                            <label className="flex items-center">
                                <input
                                    type="checkbox"
                                    className="mr-2"
                                    checked={agreedToTerms}
                                    onChange={(e) => setAgreedToTerms(e.target.checked)}
                                    required
                                />
                                By signing up, you agree to the following (Canadian) plain-english Terms and Conditions:
                                <span className="text-sm text-gray-600">
                                    <ul>
                                        <li>Anything you submit may be publicly visible and you are responsible for the content you submit, legally and otherwise. Do not submit anything you wish to keep private.</li>
                                        <li>Once content is submitted, you may not be able to edit or delete it.</li>
                                        <li>By posting content, you grant us a non-revocable, worldwide, royalty-free license to use, reproduce, modify, distribute, and display your content.</li>
                                        <li>By posting content you assert that you have the right to grant this license, or you assert that this content is made publically available under Fair Dealing in Canadian copyright law.</li>
                                        <li>We reserve the right to delete or modify any content that violates these terms.</li>
                                        <li>By signing up, you agree to handle any disputes with (or involving) us, in Canada and subject to Canadian law.</li>
                                        <li>We reserve the right to change these terms at any time without prior notice. Any changes will be posted (or linked to from) here. We will make a good faith effort to notify you of any changes to these terms via your registered email and/or on this site. Your continued use of the site after any changes constitutes your acceptance of the new terms.</li>
                                        <li>Any elements of these terms and conditions which are not consistent with Canadian law will be void, but the rest of the terms and conditions will still apply.</li>
                                    </ul>
                                </span>
                            </label>
                        </div>

                        <button
                            type="submit"
                            className="w-full bg-blue-500 text-white py-2 px-4 rounded-lg hover:bg-blue-600 focus:outline-none"
                            disabled={isChecking || !userId || !agreedToTerms}
                        >
                            Submit and Sign Up
                        </button>
                    </form>
                </div>
            </div>
        </>
    );
};

export default SignupPage; 