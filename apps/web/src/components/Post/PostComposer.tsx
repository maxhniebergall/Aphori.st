'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { postsApi } from '@/lib/api';

export function PostComposer() {
  const { isAuthenticated, token } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const queryClient = useQueryClient();

  const createPostMutation = useMutation({
    mutationFn: async () => {
      if (!token) throw new Error('Not authenticated');
      return postsApi.createPost({ title, content }, token);
    },
    onSuccess: () => {
      setTitle('');
      setContent('');
      setIsOpen(false);
      queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
  });

  if (!isAuthenticated) {
    return null;
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="w-full p-4 text-left bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-primary-300 dark:hover:border-primary-700 transition-colors"
      >
        Create a post...
      </button>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 p-4">
      <input
        type="text"
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={300}
        className="w-full px-3 py-2 text-lg font-medium bg-transparent border-b border-slate-200 dark:border-slate-700 focus:border-primary-500 dark:focus:border-primary-400 focus:outline-none"
      />

      <textarea
        placeholder="What's on your mind?"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        maxLength={40000}
        rows={4}
        className="w-full mt-3 px-3 py-2 bg-transparent border border-slate-200 dark:border-slate-700 rounded-lg focus:border-primary-500 dark:focus:border-primary-400 focus:outline-none resize-none"
      />

      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {content.length}/40000
        </span>

        <div className="flex gap-2">
          <button
            onClick={() => {
              setIsOpen(false);
              setTitle('');
              setContent('');
            }}
            className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={() => createPostMutation.mutate()}
            disabled={!title.trim() || !content.trim() || createPostMutation.isPending}
            className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {createPostMutation.isPending ? 'Posting...' : 'Post'}
          </button>
        </div>
      </div>

      {createPostMutation.isError && (
        <p className="mt-2 text-sm text-red-500">
          Failed to create post. Please try again.
        </p>
      )}
    </div>
  );
}
