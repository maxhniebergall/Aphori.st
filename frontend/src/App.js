import React, { useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import StoryTreePage from './components/StoryTreePage';
import Feed from './components/Feed';
import RequestMagicLink from './components/RequestMagicLink';
import VerifyMagicLink from './components/VerifyMagicLink';
import ProfilePage from './components/ProfilePage';
import SignupPage from './components/SignupPage';
import ProtectedRoute from './components/ProtectedRoute';
import NotFound from './components/NotFound';
import PostPage from './components/PostPage';
import { UserProvider } from './context/UserContext';
import axios from 'axios';
import 'react-quill/dist/quill.snow.css';

function App() {
    useEffect(() => {
        // Configure axios defaults
        axios.defaults.withCredentials = true;
        axios.defaults.timeout = 8000;
        
        // Add auth interceptor
        axios.interceptors.request.use((config) => {
            const token = localStorage.getItem('token');
            if (token) {
                config.headers['Authorization'] = `Bearer ${token}`;
            }
            return config;
        });

        // Add build hash to all API requests
        axios.interceptors.request.use((config) => {
            config.headers['X-Frontend-Hash'] = window.BUILD_HASH || 'development';
            return config;
        });

        // Add retry logic for CORS errors
        axios.interceptors.response.use(
            (response) => {
                console.log(`Backend build: ${response.headers['x-build-hash']}`);
                return response;
            },
            async (error) => {
                const config = error.config;
                
                // If error is CORS-related and we haven't retried yet
                if (!config._retry && error.message.includes('CORS')) {
                    config._retry = true;
                    console.warn('CORS error detected, retrying request once');
                    
                    // Wait a short moment before retrying
                    await new Promise(resolve => setTimeout(resolve, 100));
                    return axios(config);
                }
                
                return Promise.reject(error);
            }
        );
    }, []);

    return (
        <UserProvider>
            <Routes>
                <Route path="/login" element={<RequestMagicLink />} />
                <Route path="/signup" element={<SignupPage />} />
                <Route path="/verify" element={<VerifyMagicLink />} />
                <Route path="/feed" element={<Feed />} />
                <Route path="/storyTree/:uuid" element={<StoryTreePage />} />
                <Route path="/post" element={<PostPage />} />
                <Route path="/" element={<Feed />} />

                <Route 
                    path="/profile" 
                    element={
                        <ProtectedRoute>
                            <ProfilePage />
                        </ProtectedRoute>
                    } 
                />

                {/* Fallback Route */}
                <Route path="*" element={<NotFound />} />
            </Routes>
        </UserProvider>
    );
}

export default App;