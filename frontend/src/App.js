import React, { useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import StoryTreePage from './components/StoryTreePage';
import Feed from './components/Feed';
import RequestMagicLink from './components/RequestMagicLink';
import VerifyMagicLink from './components/VerifyMagicLink';
import ProfilePage from './components/ProfilePage';
import ProtectedRoute from './components/ProtectedRoute';
import NotFound from './components/NotFound';
import { UserProvider } from './context/UserContext';
import axios from 'axios';

function App() {
    useEffect(() => {
        // Configure axios defaults
        axios.defaults.withCredentials = true;
        
        // Add build hash to all API requests
        axios.interceptors.request.use((config) => {
            config.headers['X-Frontend-Hash'] = window.BUILD_HASH || 'development';
            return config;
        });

        // Log build hashes from responses
        axios.interceptors.response.use((response) => {
            console.log(`Backend build: ${response.headers['x-build-hash']}`);
            return response;
        });
    }, []);

    return (
        <UserProvider>
            <Routes>
                <Route path="/login" element={<RequestMagicLink />} />
                <Route path="/verify" element={<VerifyMagicLink />} />
                <Route path="/feed" element={<Feed />} />
                <Route path="/storyTree/:uuid" element={<StoryTreePage />} />
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