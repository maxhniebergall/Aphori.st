import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Feed from './components/Feed';
import StoryTree from './components/StoryTree';
import RedisExample from './components/RedisExample';

function App() {
    const username = "root"


    return (    
        <div className="App">
          <Routes>
            {/* Redirect root '/' to '/feed' */}
            <Route path="/" element={<Navigate to="/feed" replace />} />
    
            {/* Existing content moved to '/redisExample' */}
            <Route path="/redisExample" element={<RedisExample username={username}/>} />
    
            {/* New 'feed' route with pagination query parameter */}
            <Route path="/feed" element={<Feed />} />
    
            {/* New 'storyTree' route with UUID query parameter */}
            <Route path="/storyTree" element={<StoryTree />} />
    
            {/* Optional: Add a 404 Not Found route */}
            <Route path="*" element={<h1>404 Not Found</h1>} />
          </Routes>
        </div>
      );    
}

export default App;