/*
Requirements:
- Allow users to create posts with markdown content
- Provide markdown editing capabilities
- Handle form submission and validation
- Show loading state during submission
- Display error messages if submission fails
- Require authentication to create posts
- Preview markdown while editing

// TODO: we need to add requirements about the length of the post, both min and max length. 
*/

import React, { useState, useEffect } from 'react';
import MDEditor from '@uiw/react-md-editor';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import './PostPage.css';
import Header from './Header';
import { useUser } from '../context/UserContext';
import { Link } from 'react-router-dom';
import { PostCreationRequest } from '../types/types';

const PostPage: React.FC = (): JSX.Element => {
  const [content, setContent] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const navigate = useNavigate();
  const { state } = useUser();
  const loggedOutMessage: string = 'Please sign in to create a post';

  useEffect(() => {
    if (!state?.verified) {
      setError(loggedOutMessage);
    } else {
      setError('');
    }
  }, [state?.verified, navigate, loggedOutMessage]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();

    setIsSubmitting(true);
    setError('');
    try {
      const newPost: PostCreationRequest = {
        content: content.trim(),
      };

      await axios.post(
        `${process.env.REACT_APP_API_URL}/api/createStoryTree`,
        { post: newPost }
      );
      navigate('/');
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null) {
        const errorResponse = err as { response: { data: { message: string } } };
        setError(errorResponse.response?.data?.message || 'Failed to create post');
      } else {
        setError('Failed to create post');
      }
    } finally { 
      setIsSubmitting(false);
    }
  };

  return (
    <div className="post-page">
      <Header 
        title="Create a New Post"
        subtitle="Write your post content here using Markdown..."
        onLogoClick={() => navigate('/feed')}
      />

      {error && (
        <div className="error-message">
          {error}
          {error === loggedOutMessage && <Link to="/login"> here</Link>}
        </div>
      )}
      
      {error !== loggedOutMessage && (
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="content">Content</label>
            <div data-color-mode="light">
              <MDEditor
                value={content}
                onChange={(value?: string) => setContent(value || '')}
                preview="edit"
                height={400}
                textareaProps={{
                  placeholder: "Write your post content here using Markdown...",
                  disabled: isSubmitting,
                }}
              />
            </div>
          </div>

          <button 
            type="submit" 
            disabled={isSubmitting}
            className="submit-button"
          >
            {isSubmitting ? 'Posting...' : 'Create Post'}
          </button>
        </form>
      )}
    </div>
  );
};

export default PostPage;
