/**
 * TanStack Query mutations for themes game POST requests
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { themeGameKeys } from './queries';

const baseURL = process.env.REACT_APP_API_URL || 'http://localhost:5050';

// Types
interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

interface SubmitAttemptRequest {
  puzzleId: string;
  setName: string;
  selectedWords: string[];
  selectionOrder: number[];
}

interface SubmitAttemptResponse {
  duplicate?: boolean;
  attempt: {
    result: 'correct' | 'incorrect';
  } | null;
  duplicateOfAttemptId?: string;
  puzzleCompleted: boolean;
  message: string;
}

interface UserFingerprint {
  screenResolution: string;
  timezone: string;
  language: string;
  platform: string;
  cookieEnabled: boolean;
  doNotTrack: boolean;
}

interface TrackViewRequest {
  puzzleId: string;
  setName: string;
  puzzleNumber: number;
  fingerprint: UserFingerprint;
}

interface TrackViewResponse {
  viewId?: string;
}

interface SubmitFeedbackRequest {
  puzzleId: string;
  setName: string;
  puzzleNumber: number;
  rating: number;
  comment: string;
}

interface SubmitFeedbackResponse {
  feedbackId?: string;
}

/**
 * Submit a puzzle attempt
 */
export const useSubmitAttempt = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: SubmitAttemptRequest): Promise<SubmitAttemptResponse> => {
      const response = await fetch(`${baseURL}/api/games/themes/state/attempt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(request)
      });

      if (!response.ok) {
        throw new Error('Failed to submit attempt');
      }

      const data: ApiResponse<SubmitAttemptResponse> = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to submit attempt');
      }

      return data.data;
    },
    onSuccess: (data: SubmitAttemptResponse, variables: SubmitAttemptRequest) => {
      // Invalidate attempts query for this puzzle
      queryClient.invalidateQueries({ 
        queryKey: themeGameKeys.attempts(variables.puzzleId) 
      });

      // If the attempt was correct, also invalidate completed puzzles
      if (data.attempt && data.attempt.result === 'correct' && variables.setName) {
        queryClient.invalidateQueries({ 
          queryKey: themeGameKeys.completedPuzzles(variables.setName) 
        });
      }
    },
    onError: (error: Error) => {
      console.error('Failed to submit attempt:', error);
    },
    retry: 2,
  });
};

/**
 * Track puzzle view (fire-and-forget analytics)
 */
export const useTrackPuzzleView = () => {
  return useMutation({
    mutationFn: async (request: TrackViewRequest): Promise<TrackViewResponse> => {
      const response = await fetch(`${baseURL}/api/games/themes/analytics/view`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(request)
      });

      if (!response.ok) {
        throw new Error('Failed to track puzzle view');
      }

      const data: ApiResponse<TrackViewResponse> = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to track puzzle view');
      }

      return data.data;
    },
    onSuccess: (data: TrackViewResponse) => {
      console.debug('Puzzle view tracked successfully:', data.viewId);
    },
    onError: (error: Error) => {
      // Fire-and-forget: log but don't throw
      console.warn('Failed to track puzzle view:', error);
    },
    retry: 1, // Only retry once for analytics
  });
};

/**
 * Submit puzzle feedback (fire-and-forget analytics)
 */
export const useSubmitFeedback = () => {
  return useMutation({
    mutationFn: async (request: SubmitFeedbackRequest): Promise<SubmitFeedbackResponse> => {
      const response = await fetch(`${baseURL}/api/games/themes/analytics/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(request)
      });

      if (!response.ok) {
        throw new Error('Failed to submit feedback');
      }

      const data: ApiResponse<SubmitFeedbackResponse> = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to submit feedback');
      }

      return data.data;
    },
    onSuccess: (data: SubmitFeedbackResponse) => {
      console.log('Feedback submitted successfully:', data.feedbackId);
    },
    onError: (error: Error) => {
      // Fire-and-forget: log but don't throw
      console.error('Failed to submit feedback:', error);
    },
    retry: 1, // Only retry once for analytics
  });
};