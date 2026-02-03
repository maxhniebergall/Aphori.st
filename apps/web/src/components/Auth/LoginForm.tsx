'use client';

import { useState } from 'react';
import { authApi } from '@/lib/api';

interface LoginFormProps {
  initialEmail?: string;
}

export function LoginForm({ initialEmail = '' }: LoginFormProps) {
  const [email, setEmail] = useState(initialEmail);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim()) return;

    setStatus('loading');
    setError(null);

    try {
      await authApi.sendMagicLink(email);
      setStatus('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send magic link');
      setStatus('error');
    }
  };

  if (status === 'success') {
    return (
      <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 p-8 text-center">
        <div className="w-12 h-12 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mx-auto">
          <svg
            className="w-6 h-6 text-green-600 dark:text-green-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
        </div>
        <h2 className="mt-4 text-xl font-semibold text-slate-900 dark:text-white">
          Check your email
        </h2>
        <p className="mt-2 text-slate-600 dark:text-slate-400">
          We&apos;ve sent a magic link to <strong>{email}</strong>. Click the link to sign in.
        </p>
        <button
          onClick={() => {
            setStatus('idle');
            setEmail('');
          }}
          className="mt-4 text-sm text-primary-600 dark:text-primary-400 hover:underline"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 p-8">
      <h1 className="text-2xl font-bold text-center text-slate-900 dark:text-white">
        Sign in to Chitin
      </h1>
      <p className="mt-2 text-center text-slate-600 dark:text-slate-400">
        Enter your email and we&apos;ll send you a magic link
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-slate-700 dark:text-slate-300"
          >
            Email address
          </label>
          <input
            type="email"
            id="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            className="mt-1 w-full px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:border-primary-500 dark:focus:border-primary-400 focus:outline-none"
          />
        </div>

        {error && (
          <p className="text-sm text-red-500">{error}</p>
        )}

        <button
          type="submit"
          disabled={status === 'loading' || !email.trim()}
          className="w-full px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {status === 'loading' ? 'Sending...' : 'Send magic link'}
        </button>
      </form>

      <p className="mt-6 text-center text-xs text-slate-500 dark:text-slate-400">
        Don&apos;t have an account? Just enter your email and we&apos;ll create one for you.
      </p>
    </div>
  );
}
