import { useCallback } from 'react';
import { useThemeShareableResults } from './queries';

export interface ShareableResults {
  date: string;
  shareableText: string;
  puzzleResults: ShareablePuzzle[];
  summary: {
    completedPuzzles: number;
    totalPuzzles: number;
    totalAttempts: number;
  };
}

interface ShareablePuzzle {
  puzzleNumber: number;
  attempts: number;
  completed: boolean;
  emojiRows: string[];
}

export const useShareableResults = (setName: string, puzzleNumber: number, enabled = true) => {
  const { 
    data: shareableData, 
    isLoading: loading, 
    error 
  } = useThemeShareableResults(setName, puzzleNumber, enabled);

  const copyToClipboard = useCallback(async () => {
    if (!shareableData?.shareableText) return false;

    try {
      await navigator.clipboard.writeText(shareableData.shareableText);
      return true;
    } catch (err) {
      // Fallback for browsers that don't support clipboard API
      const textArea = document.createElement('textarea');
      textArea.value = shareableData.shareableText;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      
      try {
        document.execCommand('copy');
        return true;
      } catch (fallbackErr) {
        return false;
      } finally {
        document.body.removeChild(textArea);
      }
    }
  }, [shareableData?.shareableText]);

  const shareNative = useCallback(async () => {
    if (!shareableData?.shareableText) return false;

    if (navigator.share) {
      try {
        await navigator.share({
          title: `Themes ${shareableData.date}`,
          text: shareableData.shareableText
        });
        return true;
      } catch (err) {
        // User cancelled or error occurred
        return false;
      }
    }
    
    // Fallback to clipboard
    return copyToClipboard();
  }, [shareableData, copyToClipboard]);

  return {
    shareableData,
    loading,
    error: error?.message || null,
    copyToClipboard,
    shareNative
  };
};