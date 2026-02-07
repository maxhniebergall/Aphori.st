'use client';

import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { postsApi } from '@/lib/api';

const DRAFT_KEY = 'chitin_post_draft';
const DRAFT_DEBOUNCE_MS = 500;

export function PostComposer() {
  const { isAuthenticated, token } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const queryClient = useQueryClient();

  // Restore draft when composer opens
  useEffect(() => {
    if (!isOpen) return;

    if (typeof window === 'undefined') return;

    try {
      const stored = localStorage.getItem(DRAFT_KEY);
      if (stored) {
        const draft = JSON.parse(stored);
        if (draft?.title && typeof draft.title === 'string') {
          setTitle(draft.title);
        }
        if (draft?.content && typeof draft.content === 'string') {
          setContent(draft.content);
        }
      } else {
        // No draft in localStorage, clear the form
        setTitle('');
        setContent('');
      }
    } catch (e) {
      console.error('Failed to restore draft:', e);
    }
  }, [isOpen]);

  // Auto-save draft with debounce (only when composer is open)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isOpen) return; // Only auto-save when composer is visible

    const timeoutId = setTimeout(() => {
      try {
        // Clear draft if both fields are empty (user explicitly cleared them)
        if (!title.trim() && !content.trim()) {
          localStorage.removeItem(DRAFT_KEY);
          return;
        }

        // Save draft
        const draft = {
          title,
          content,
          timestamp: Date.now(),
        };
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      } catch (e) {
        console.error('Failed to save draft:', e);
      }
    }, DRAFT_DEBOUNCE_MS);

    return () => clearTimeout(timeoutId);
  }, [isOpen, title, content]);

  const createPostMutation = useMutation({
    mutationFn: async () => {
      if (!token) throw new Error('Not authenticated');
      return postsApi.createPost({ title, content }, token);
    },
    onSuccess: () => {
      setTitle('');
      setContent('');
      setIsOpen(false);

      // Clear draft from localStorage
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch (e) {
        console.error('Failed to clear draft:', e);
      }

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
        maxLength={2000}
        rows={4}
        className="w-full mt-3 px-3 py-2 bg-transparent border border-slate-200 dark:border-slate-700 rounded-lg focus:border-primary-500 dark:focus:border-primary-400 focus:outline-none resize-none"
      />

      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {content.length}/2000
        </span>

        <div className="flex gap-2">
          <button
            onClick={() => setShowDeleteConfirm(true)}
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

      {/* Delete Draft Confirmation Dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg max-w-sm w-full mx-4">
            <div className="p-6">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
                Delete draft?
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
                Are you sure you want to delete this draft? This action cannot be undone.
              </p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                >
                  Keep Draft
                </button>
                <button
                  onClick={() => {
                    setTitle('');
                    setContent('');
                    try {
                      localStorage.removeItem(DRAFT_KEY);
                    } catch (e) {
                      console.error('Failed to clear draft:', e);
                    }
                    setIsOpen(false);
                    setShowDeleteConfirm(false);
                  }}
                  className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
                >
                  Delete Draft
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
