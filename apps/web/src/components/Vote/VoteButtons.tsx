'use client';

import { useState, useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useAuth } from '@/contexts/AuthContext';
import { votesApi } from '@/lib/api';
import type { VoteValue } from '@chitin/shared';

interface VoteButtonsProps {
  targetType: 'post' | 'reply';
  targetId: string;
  score: number;
}

export function VoteButtons({ targetType, targetId, score }: VoteButtonsProps) {
  const { isAuthenticated, token } = useAuth();
  const [currentVote, setCurrentVote] = useState<VoteValue | null>(null);
  const [optimisticScore, setOptimisticScore] = useState(score);
  const queryClient = useQueryClient();
  const previousVoteRef = useRef<VoteValue | null>(null);
  const previousScoreRef = useRef(score);

  const voteMutation = useMutation({
    mutationFn: async (value: VoteValue) => {
      if (!token) throw new Error('Not authenticated');

      const previousVote = currentVote;
      previousVoteRef.current = previousVote;
      previousScoreRef.current = optimisticScore;

      // Optimistic update
      if (previousVote === value) {
        // Remove vote
        setCurrentVote(null);
        setOptimisticScore((s) => s - value);
        await votesApi.removeVote(targetType, targetId, token);
      } else {
        // Add or change vote
        const scoreChange = previousVote ? value * 2 : value;
        setCurrentVote(value);
        setOptimisticScore((s) => s + scoreChange);
        await votesApi.vote({ target_type: targetType, target_id: targetId, value }, token);
      }
    },
    onError: () => {
      // Revert optimistic update
      setCurrentVote(previousVoteRef.current);
      setOptimisticScore(previousScoreRef.current);
      toast.error('Failed to save vote. Please try again.');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
  });

  // Sync score prop with optimistic score
  useEffect(() => {
    setOptimisticScore(score);
  }, [score]);

  const handleVote = (value: VoteValue) => {
    if (!isAuthenticated) return;
    voteMutation.mutate(value);
  };

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        onClick={() => handleVote(1)}
        disabled={!isAuthenticated || voteMutation.isPending}
        className={`p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors disabled:cursor-not-allowed ${
          currentVote === 1
            ? 'text-primary-600 dark:text-primary-400'
            : 'text-slate-400 dark:text-slate-500'
        }`}
        aria-label="Upvote"
      >
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M14.77 12.79a.75.75 0 01-1.06-.02L10 8.832 6.29 12.77a.75.75 0 11-1.08-1.04l4.25-4.5a.75.75 0 011.08 0l4.25 4.5a.75.75 0 01-.02 1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      <span
        className={`text-sm font-medium ${
          currentVote === 1
            ? 'text-primary-600 dark:text-primary-400'
            : currentVote === -1
            ? 'text-red-500'
            : 'text-slate-700 dark:text-slate-300'
        }`}
      >
        {optimisticScore}
      </span>

      <button
        onClick={() => handleVote(-1)}
        disabled={!isAuthenticated || voteMutation.isPending}
        className={`p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors disabled:cursor-not-allowed ${
          currentVote === -1
            ? 'text-red-500'
            : 'text-slate-400 dark:text-slate-500'
        }`}
        aria-label="Downvote"
      >
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>
    </div>
  );
}
