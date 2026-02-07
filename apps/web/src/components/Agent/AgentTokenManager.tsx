'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { agentsApi } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

interface AgentTokenManagerProps {
  agentId: string;
}

export function AgentTokenManager({ agentId }: AgentTokenManagerProps) {
  const { token } = useAuth();
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);

  const generateMutation = useMutation({
    mutationFn: () => agentsApi.generateToken(agentId, token!),
    onSuccess: (data) => {
      setGeneratedToken(data.token);
      toast.success('Token generated (expires in 1 hour)');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to generate token');
    },
  });

  const revokeMutation = useMutation({
    mutationFn: () => agentsApi.revokeTokens(agentId, token!),
    onSuccess: (data) => {
      setGeneratedToken(null);
      setShowRevokeConfirm(false);
      toast.success(`${data.revoked_count} token(s) revoked`);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to revoke tokens');
    },
  });

  const copyToken = async () => {
    if (!generatedToken) return;
    try {
      await navigator.clipboard.writeText(generatedToken);
      toast.success('Token copied to clipboard');
    } catch {
      toast.error('Failed to copy token');
    }
  };

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium text-slate-700 dark:text-slate-300">
        Token Management
      </h4>

      {generatedToken && (
        <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <p className="text-xs text-green-700 dark:text-green-300 mb-2">
            Token generated. Copy it now - it won&apos;t be shown again.
          </p>
          <div className="flex gap-2">
            <code className="flex-1 text-xs bg-white dark:bg-slate-800 p-2 rounded border border-green-200 dark:border-green-700 text-slate-800 dark:text-slate-200 overflow-hidden text-ellipsis">
              {generatedToken}
            </code>
            <button
              onClick={copyToken}
              className="px-3 py-1 text-xs font-medium text-green-700 dark:text-green-300 border border-green-300 dark:border-green-700 rounded hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors"
            >
              Copy
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending}
          className="px-3 py-1.5 text-xs font-medium text-white bg-primary-600 rounded hover:bg-primary-700 transition-colors disabled:opacity-50"
        >
          {generateMutation.isPending ? 'Generating...' : 'Generate Token'}
        </button>

        {showRevokeConfirm ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-red-600 dark:text-red-400">Revoke all tokens?</span>
            <button
              onClick={() => revokeMutation.mutate()}
              disabled={revokeMutation.isPending}
              className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 rounded hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              {revokeMutation.isPending ? 'Revoking...' : 'Confirm'}
            </button>
            <button
              onClick={() => setShowRevokeConfirm(false)}
              className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowRevokeConfirm(true)}
            className="px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 border border-red-300 dark:border-red-700 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            Revoke All Tokens
          </button>
        )}
      </div>
    </div>
  );
}
