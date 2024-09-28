// components/Feed.js
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import './Feed.css';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';

function Feed() {
  const [feedItems, setFeedItems] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const page = parseInt(searchParams.get('page')) || 1;

  useEffect(() => {
    const fetchFeedItems = async () => {
      try {
        const response = await axios.get(`${process.env.REACT_APP_API_BASE_URL}/api/storyTree`, {
          params: { uuid: initialUUID },
        });
        

        const data = response.data;
        setFeedItems(data.items);
      } catch (error) {
        console.error('Error fetching feed items:', error);
      }
    };

    fetchFeedItems();
  }, [page]);


  return (
    <div>
      <h1>Feed Page</h1>
      <p>Current Page: {page}</p>
      {/* Display feed items based on the current page */}

      {/* Pagination Controls */}
      <button onClick={() => goToPage(page - 1)} disabled={page <= 1}>
        Previous
      </button>
      <button onClick={() => goToPage(page + 1)}>Next</button>
    </div>
  );
}

export default Feed;
