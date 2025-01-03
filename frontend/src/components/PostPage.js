/*
Requirements:
- Allow users to create posts with title and rich text content
- Provide rich text editing capabilities
- Handle form submission and validation
- Show loading state during submission
- Display error messages if submission fails
- Require authentication to create posts
*/

import React, { useState, useEffect } from 'react';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import './PostPage.css';
import Header from './Header';
import { useUser } from '../context/UserContext';
import { Link } from 'react-router-dom';

function PostPage() {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { state} = useUser();
  const loggedOutMessage = 'Please sign in to create a post';

  // Quill editor modules/formats configuration
  const modules = {
    toolbar: [
      [{ 'header': [1, 2, false] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{'list': 'ordered'}, {'list': 'bullet'}],
      ['link', 'blockquote'],
      ['clean']
    ],
  };

  useEffect(() => {
    if (!state?.verified) {
      setError(loggedOutMessage);
    } else {
      setError('');
        }
  }, [state?.verified, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!title.trim() || !content.trim()) {
      setError('Please fill in both title and content');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      await axios.post(
        `${process.env.REACT_APP_API_URL}/api/createStoryTree`, 
        {
          storyTree: {
            title: title.trim(),
            content: content.trim()
          }
        }
      );
      navigate('/'); // Redirect to home page after successful post
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create post');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="post-page">
        <Header 
          title="Create a New Post"
          onLogoClick={() => navigate('/feed')}
        />

      {error && <div className="error-message">{error}{ error === loggedOutMessage && <Link to="/login"> here</Link>}</div>}
      
      { error !== loggedOutMessage &&
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="title">Title</label>
          <input
            type="text"
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Enter your post title"
            disabled={isSubmitting}
          />
        </div>

        <div className="form-group">
          <label htmlFor="content">Content</label>
          <ReactQuill
            value={content}
            onChange={setContent}
            modules={modules}
            placeholder="Write your post content here..."
            theme="snow"
            disabled={isSubmitting}
          />
        </div>

        <button 
          type="submit" 
          disabled={isSubmitting}
          className="submit-button"
        >
          {isSubmitting ? 'Posting...' : 'Create Post'}
            </button>
          </form>
        }
    </div>
  );
}

export default PostPage;
