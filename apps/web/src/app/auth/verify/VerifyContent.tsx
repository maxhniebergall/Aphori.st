'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { authApi } from '@/lib/api';
import { LoginForm } from '@/components/Auth/LoginForm';

export function VerifyContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, isAuthenticated, isLoading: authLoading } = useAuth();
  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'form'>('loading');
  const [error, setError] = useState<string | null>(null);

  const token = searchParams.get('token');
  const email = searchParams.get('email');
  const mcpCallback = searchParams.get('mcp_callback');

  useEffect(() => {
    if (authLoading) return;

    if (isAuthenticated && !mcpCallback) {
      router.push('/');
      return;
    }

    if (!token) {
      setStatus('form');
      return;
    }

    const verifyToken = async () => {
      try {
        const result = await authApi.verifyMagicLink(token);

        // If MCP callback is present and is a localhost URL, redirect with the token
        if (mcpCallback) {
          try {
            const callbackUrl = new URL(mcpCallback);
            if (callbackUrl.hostname === 'localhost' || callbackUrl.hostname === '127.0.0.1') {
              callbackUrl.searchParams.set('token', result.token);
              setStatus('success');
              window.location.href = callbackUrl.toString();
              return;
            }
          } catch {
            // Invalid URL — fall through to normal flow
          }
        }

        await login(result.token);
        setStatus('success');
        setTimeout(() => router.push('/'), 1500);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Verification failed');
        setStatus('error');
      }
    };

    verifyToken();
  }, [token, authLoading, isAuthenticated, login, router, mcpCallback]);

  if (authLoading || status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin mx-auto" />
          <p className="mt-4 text-slate-600 dark:text-slate-400">
            Verifying your magic link...
          </p>
        </div>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-center">
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
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h1 className="mt-4 text-xl font-semibold text-slate-900 dark:text-white">
            Signed in successfully!
          </h1>
          <p className="mt-2 text-slate-600 dark:text-slate-400">
            {mcpCallback ? 'Returning to your MCP client...' : 'Redirecting you to the home page...'}
          </p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-center max-w-md">
          <div className="w-12 h-12 bg-red-100 dark:bg-red-900 rounded-full flex items-center justify-center mx-auto">
            <svg
              className="w-6 h-6 text-red-600 dark:text-red-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>
          <h1 className="mt-4 text-xl font-semibold text-slate-900 dark:text-white">
            Verification failed
          </h1>
          <p className="mt-2 text-slate-600 dark:text-slate-400">
            {error || 'The link may have expired. Please request a new one.'}
          </p>
          <button
            onClick={() => setStatus('form')}
            className="mt-4 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <LoginForm initialEmail={email ?? undefined} mcpCallback={mcpCallback ?? undefined} />
    </div>
  );
}
