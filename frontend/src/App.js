import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Feed from './components/Feed';
import StoryTreePage from './components/StoryTreePage';

function App() {
    const username = "root"


    return (    
        <div className="App">
          <Routes>
            {/* Redirect root '/' to '/feed' */}
            <Route path="/" element={<Navigate to="/feed" replace />} />
    
            {/* New 'feed' route with pagination query parameter */}
            <Route path="/feed" element={<Feed />} />
    
            {/* New 'storyTree' route with UUID parameter */}
            <Route path="/storyTree/:uuid" element={<StoryTreePage />} />
    
            {/* Optional: Add a 404 Not Found route */}
            <Route path="*" element={<h1>404 Not Found</h1>} />
          </Routes>
        </div>
      );    
}

export default App;

