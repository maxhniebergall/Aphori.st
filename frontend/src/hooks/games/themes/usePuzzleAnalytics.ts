/**
 * Hook for tracking themes game analytics
 * Handles puzzle view tracking and feedback submission
 */

import { useCallback } from 'react';

interface UserFingerprint {
  screenResolution: string;
  timezone: string;
  language: string;
  platform: string;
  cookieEnabled: boolean;
  doNotTrack: boolean;
}

interface PuzzleFeedback {
  rating: number;
  comment: string;
}

export function usePuzzleAnalytics() {
  /**
   * Collect browser fingerprint data
   */
  const collectFingerprint = useCallback((): UserFingerprint => {
    return {
      screenResolution: `${window.screen.width}x${window.screen.height}`,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
      language: navigator.language || 'unknown',
      platform: navigator.platform || 'unknown',
      cookieEnabled: navigator.cookieEnabled,
      doNotTrack: navigator.doNotTrack === '1'
    };
  }, []);

  /**
   * Track puzzle view
   */
  const trackPuzzleView = useCallback(async (
    puzzleId: string,
    setName: string,
    puzzleNumber: number
  ): Promise<boolean> => {
    try {
      const fingerprint = collectFingerprint();
      
      const response = await fetch('/api/games/themes/analytics/view', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Include cookies for temp user ID
        body: JSON.stringify({
          puzzleId,
          setName,
          puzzleNumber,
          fingerprint
        }),
      });

      const data = await response.json();
      
      if (!data.success) {
        console.warn('Failed to track puzzle view:', data.error);
        return false;
      }

      console.debug('Puzzle view tracked successfully:', data.data?.viewId);
      return true;
    } catch (error) {
      console.error('Error tracking puzzle view:', error);
      return false;
    }
  }, [collectFingerprint]);

  /**
   * Submit puzzle feedback
   */
  const submitFeedback = useCallback(async (
    puzzleId: string,
    setName: string,
    puzzleNumber: number,
    feedback: PuzzleFeedback
  ): Promise<boolean> => {
    try {
      const response = await fetch('/api/games/themes/analytics/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Include cookies for temp user ID
        body: JSON.stringify({
          puzzleId,
          setName,
          puzzleNumber,
          rating: feedback.rating,
          comment: feedback.comment
        }),
      });

      const data = await response.json();
      
      if (!data.success) {
        console.error('Failed to submit feedback:', data.error);
        return false;
      }

      console.log('Feedback submitted successfully:', data.data?.feedbackId);
      return true;
    } catch (error) {
      console.error('Error submitting feedback:', error);
      return false;
    }
  }, []);

  /**
   * Get analytics stats (admin function)
   */
  const getAnalyticsStats = useCallback(async () => {
    try {
      const response = await fetch('/api/games/themes/analytics/stats', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      });

      const data = await response.json();
      
      if (!data.success) {
        console.error('Failed to get analytics stats:', data.error);
        return null;
      }

      return data.data;
    } catch (error) {
      console.error('Error getting analytics stats:', error);
      return null;
    }
  }, []);

  return {
    trackPuzzleView,
    submitFeedback,
    getAnalyticsStats,
    collectFingerprint
  };
}