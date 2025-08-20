import { useState, useCallback } from 'react';

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

export const useShareableResults = () => {
  const [shareableData, setShareableData] = useState<ShareableResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchShareableResults = useCallback(async (setName: string, puzzleNumber: number) => {
    setLoading(true);
    setError(null);

    try {
      const baseURL = process.env.REACT_APP_API_URL || 'http://localhost:5050';
      const response = await fetch(`${baseURL}/api/games/themes/state/shareable/${setName}/${puzzleNumber}`, {
        credentials: 'include'
      });
      
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch shareable results');
      }

      setShareableData(data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch shareable results');
    } finally {
      setLoading(false);
    }
  }, []);

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
    error,
    fetchShareableResults,
    copyToClipboard,
    shareNative
  };
};