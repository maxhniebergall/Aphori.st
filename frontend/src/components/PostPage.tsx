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

const MAX_POST_LENGTH = 5000;
const MIN_POST_LENGTH = 100;

const PostPage: React.FC = (): JSX.Element => {
  const [content, setContent] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const navigate = useNavigate();
  const { state } = useUser();
  const loggedOutMessage: string = 'Please sign in to create a post';
  const lengthExceededError: string = `Post content cannot exceed ${MAX_POST_LENGTH} characters.`;
  const lengthInsufficientError: string = `Post content must be at least ${MIN_POST_LENGTH} characters.`;
  const [isLengthExceeded, setIsLengthExceeded] = useState<boolean>(false);
  const [isLengthInsufficient, setIsLengthInsufficient] = useState<boolean>(false);

  useEffect(() => {
    if (!state?.verified) {
      setError(loggedOutMessage);
    } else {
      // Clear login error if verified, but preserve length errors
      if (error === loggedOutMessage) {
        setError('');
      }
    }
  }, [state?.verified, loggedOutMessage, error]);

  const handleContentChange = (value?: string) => {
    const newContent = value || '';
    setContent(newContent);

    const length = newContent.length;
    let currentError = '';
    let exceeded = false;
    let insufficient = false;

    if (length > MAX_POST_LENGTH) {
      currentError = lengthExceededError;
      exceeded = true;
    } else if (length > 0 && length < MIN_POST_LENGTH) {
      currentError = lengthInsufficientError;
      insufficient = true;
    }

    setIsLengthExceeded(exceeded);
    setIsLengthInsufficient(insufficient);

    // Update error only if it's a length-related error or clearing one
    if (currentError || error === lengthExceededError || error === lengthInsufficientError) {
        setError(currentError);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();

    // Trim content first
    const trimmedContent = content.trim();

    // Check length before attempting submission using trimmed content
    if (trimmedContent.length > MAX_POST_LENGTH) {
      setError(lengthExceededError);
      setIsLengthExceeded(true); // Keep state updated for UI feedback
      window.alert(lengthExceededError);
      return;
    }
    if (trimmedContent.length < MIN_POST_LENGTH) {
      setError(lengthInsufficientError);
      setIsLengthInsufficient(true); // Keep state updated for UI feedback
      window.alert(lengthInsufficientError);
      return;
    }

    // Clear length errors if checks pass
    setIsLengthExceeded(false);
    setIsLengthInsufficient(false);
    if (error === lengthExceededError || error === lengthInsufficientError) {
        setError('');
    }

    setIsSubmitting(true);
    setError(''); // Clear previous errors before new attempt
    try {
      const newPost: PostCreationRequest = {
        content: trimmedContent, // Use trimmed content for the request
      };

      await axios.post(
        `${process.env.REACT_APP_API_URL}/api/createStoryTree`,
        { storyTree: newPost }
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

  // Update canSubmit logic to use trimmed length
  const canSubmit = state?.verified && !isSubmitting && content.trim().length >= MIN_POST_LENGTH && content.trim().length <= MAX_POST_LENGTH;

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
                onChange={handleContentChange}
                preview="edit"
                height={400}
                textareaProps={{
                  placeholder: "Write your post content here using Markdown...",
                  disabled: isSubmitting || !state?.verified,
                }}
              />
            </div>
            <div className="char-count" style={{ color: isLengthExceeded ? 'red' : 'inherit' }}>
              {content.length}/{MAX_POST_LENGTH}
            </div>
          </div>

          <button 
            type="submit" 
            disabled={!canSubmit} // Use updated canSubmit logic
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
