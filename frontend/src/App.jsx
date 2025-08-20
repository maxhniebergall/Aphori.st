import { useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import PostTreePage from './components/PostTreePage';
import Feed from './components/Feed';
import RequestMagicLink from './components/RequestMagicLink';
import VerifyMagicLink from './components/VerifyMagicLink';
import ProfilePage from './components/ProfilePage';
import SignupPage from './components/SignupPage';
import ProtectedRoute from './components/ProtectedRoute';
import NotFound from './components/NotFound';
import PostPage from './components/PostPage';
import SearchResultsPage from './components/SearchResultsPage';
import DuplicateComparisonPage from './components/DuplicateComparisonPage';
import { GamesLanding } from './pages/games/GamesLanding';
import { ThemesGame } from './pages/games/themes/ThemesGame';
import { UserProvider } from './context/UserContext';
import axios from 'axios';
import { setupCache, buildWebStorage } from 'axios-cache-interceptor';

// Configure Axios with caching
// Cache will persist in localStorage for 24 hours
setupCache(axios, {
  ttl: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
  storage: buildWebStorage(localStorage, 'axios-cache:'),
});

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
                if (process.env.NODE_ENV !== 'development') {
                    // Production-only logging
                    console.log(`Backend build: ${response.headers['x-build-hash']}`); 
                }
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
                <Route path="/postTree/:uuid" element={<PostTreePage />} />
                <Route path="/post" element={<PostPage />} />
                <Route path="/" element={<Feed />} />
                <Route path="/search" element={<SearchResultsPage />} />
                <Route path="/dupe/:groupId" element={<DuplicateComparisonPage />} />
                <Route path="/games" element={<GamesLanding />} />
                <Route path="/games/themes" element={<ThemesGame />} />
                <Route path="/games/themes/:setName" element={<ThemesGame />} />
                <Route path="/games/themes/:setName/puzzle/:puzzleNumber" element={<ThemesGame />} />

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