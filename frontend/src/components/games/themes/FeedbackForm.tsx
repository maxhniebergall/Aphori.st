import React, { useState } from 'react';
import { usePuzzleAnalytics } from '../../../hooks/games/themes/usePuzzleAnalytics';
import './FeedbackForm.css';

interface FeedbackFormProps {
  puzzleId: string;
  setName: string;
  puzzleNumber: number;
  onSubmitted?: () => void;
}

export const FeedbackForm: React.FC<FeedbackFormProps> = ({
  puzzleId,
  setName,
  puzzleNumber,
  onSubmitted
}) => {
  const [rating, setRating] = useState<number>(0);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { submitFeedback } = usePuzzleAnalytics();

  const handleStarClick = (star: number) => {
    setRating(star);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (rating === 0) {
      setError('Please select a rating');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const success = await submitFeedback(puzzleId, setName, puzzleNumber, {
        rating,
        comment: comment.trim()
      });

      if (success) {
        setIsSubmitted(true);
        onSubmitted?.();
      } else {
        setError('Failed to submit feedback. Please try again.');
      }
    } catch (err) {
      setError('An error occurred while submitting feedback.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSubmitted) {
    return (
      <div className="feedback-form submitted">
        <div className="feedback-success">
          <h3>✅ Thank you for your feedback!</h3>
          <p>Your feedback helps us improve puzzle generation.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="feedback-form">
      <h3>Rate This Puzzle</h3>
      <p>Help us improve by rating this puzzle and leaving feedback!</p>
      
      <form onSubmit={handleSubmit}>
        {/* Star Rating */}
        <div className="rating-section">
          <label>Overall Rating:</label>
          <div className="star-rating">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                className={`star ${star <= rating ? 'active' : ''}`}
                onClick={() => handleStarClick(star)}
                disabled={isSubmitting}
              >
                ★
              </button>
            ))}
          </div>
          {rating > 0 && (
            <div className="rating-text">
              {rating === 1 && "Poor"}
              {rating === 2 && "Fair"} 
              {rating === 3 && "Good"}
              {rating === 4 && "Very Good"}
              {rating === 5 && "Excellent"}
            </div>
          )}
        </div>

        {/* Comment Section */}
        <div className="comment-section">
          <label htmlFor="comment">Additional Comments (Optional):</label>
          <textarea
            id="comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What did you think of this puzzle? Any suggestions?"
            rows={3}
            maxLength={500}
            disabled={isSubmitting}
          />
          <div className="char-count">
            {comment.length}/500
          </div>
        </div>

        {error && (
          <div className="error-message">
            {error}
          </div>
        )}

        {/* Submit Button */}
        <div className="submit-section">
          <button 
            type="submit" 
            className="submit-feedback-button"
            disabled={isSubmitting || rating === 0}
          >
            {isSubmitting ? 'Submitting...' : 'Submit Feedback'}
          </button>
        </div>
      </form>
    </div>
  );
};