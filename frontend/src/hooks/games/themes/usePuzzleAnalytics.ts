/**
 * Hook for tracking themes game analytics
 * Handles puzzle view tracking and feedback submission
 */

import { useCallback } from 'react';
import { useTrackPuzzleView, useSubmitFeedback } from './mutations';

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
  const trackViewMutation = useTrackPuzzleView();
  const submitFeedbackMutation = useSubmitFeedback();

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
      
      await trackViewMutation.mutateAsync({
        puzzleId,
        setName,
        puzzleNumber,
        fingerprint
      });

      return true;
    } catch (error) {
      // Error already logged by mutation's onError handler
      return false;
    }
  }, [collectFingerprint, trackViewMutation]);

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
      await submitFeedbackMutation.mutateAsync({
        puzzleId,
        setName,
        puzzleNumber,
        rating: feedback.rating,
        comment: feedback.comment
      });

      return true;
    } catch (error) {
      // Error already logged by mutation's onError handler
      return false;
    }
  }, [submitFeedbackMutation]);

  return {
    trackPuzzleView,
    submitFeedback,
    collectFingerprint
  };
}