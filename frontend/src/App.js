import React from 'react';
import { Routes, Route } from 'react-router-dom';
import StoryTreePage from './components/StoryTreePage';
import Feed from './components/Feed';
import RequestMagicLink from './components/RequestMagicLink';
import VerifyMagicLink from './components/VerifyMagicLink';
import ProfilePage from './components/ProfilePage';
import ProtectedRoute from './components/ProtectedRoute';
import NotFound from './components/NotFound';
import { UserProvider } from './context/UserContext';

function App() {
    return (
        <UserProvider>
            <Routes>
                <Route path="/login" element={<RequestMagicLink />} />
                <Route path="/verify" element={<VerifyMagicLink />} />
                <Route path="/feed" element={<Feed />} />
                <Route path="/storyTree/:uuid" element={<StoryTreePage />} />

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

