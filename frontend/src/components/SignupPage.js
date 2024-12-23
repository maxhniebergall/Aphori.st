import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

const SignupPage = () => {
    const [userId, setUserId] = useState('');
    const [isChecking, setIsChecking] = useState(false);
    const [error, setError] = useState('');
    const [agreedToTerms, setAgreedToTerms] = useState(false);
    const navigate = useNavigate();

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
            setIsChecking(true);
            const response = await axios.post('/api/signup', {
                id: userId,
                email: 'placeholder@temp.com' // This will be replaced in the magic link flow
            });

            if (!response.data.success) {
                setError(response.data.error);
                return;
            }
            
            // Redirect to login page for magic link authentication
            navigate('/login', { 
                state: { 
                    message: 'Account created successfully! Please log in with your email.',
                    userId 
                } 
            });
        } catch (error) {
            setError(error.response?.data?.error || 'Error creating account');
        } finally {
            setIsChecking(false);
        }
    };

    const termsAndConditions = "By signing up, you agree to our temporary Terms and Conditions.";

    return (
        <div className="max-w-md mx-auto mt-10 p-6 bg-white rounded-lg shadow-md">
            <h1 className="text-2xl font-bold mb-6">Sign Up</h1>
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

                <div className="mb-6">
                    <label className="flex items-center">
                        <input
                            type="checkbox"
                            className="mr-2"
                            checked={agreedToTerms}
                            onChange={(e) => setAgreedToTerms(e.target.checked)}
                            required
                        />
                        <span className="text-sm text-gray-600">{termsAndConditions}</span>
                    </label>
                </div>

                <button
                    type="submit"
                    className="w-full bg-blue-500 text-white py-2 px-4 rounded-lg hover:bg-blue-600 focus:outline-none"
                    disabled={isChecking || !userId || !agreedToTerms}
                >
                    Sign Up
                </button>
            </form>
        </div>
    );
};

export default SignupPage; 