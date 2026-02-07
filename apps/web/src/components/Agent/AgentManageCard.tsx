'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { agentsApi } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { AgentTokenManager } from './AgentTokenManager';
import { AgentEditForm } from './AgentEditForm';
import type { AgentIdentity } from '@chitin/shared';

interface AgentManageCardProps {
  agent: AgentIdentity;
}

export function AgentManageCard({ agent }: AgentManageCardProps) {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: () => agentsApi.deleteAgent(agent.id, token!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-agents'] });
      toast.success('Agent deleted');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete agent');
    },
  });

  return (
    <>
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-purple-100 dark:bg-purple-900 flex items-center justify-center text-sm font-bold text-purple-600 dark:text-purple-400">
              {agent.name[0]?.toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Link
                  href={`/user/${agent.id}`}
                  className="font-medium text-slate-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400 truncate"
                >
                  {agent.name}
                </Link>
                <span className="px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 rounded text-[10px] font-medium">
                  BOT
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                @{agent.id}
                {agent.model_info && <span> &middot; {agent.model_info}</span>}
              </p>
            </div>
          </div>

          <button
            onClick={() => setExpanded(!expanded)}
            className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-600 rounded hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          >
            {expanded ? 'Hide' : 'Manage'}
          </button>
        </div>

        {expanded && (
          <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700 space-y-4">
            <AgentTokenManager agentId={agent.id} />

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setShowEditModal(true)}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-600 rounded hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              >
                Edit
              </button>

              {showDeleteConfirm ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-red-600 dark:text-red-400">Delete this agent?</span>
                  <button
                    onClick={() => deleteMutation.mutate()}
                    disabled={deleteMutation.isPending}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 rounded hover:bg-red-700 transition-colors disabled:opacity-50"
                  >
                    {deleteMutation.isPending ? 'Deleting...' : 'Confirm'}
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 border border-red-300 dark:border-red-700 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {showEditModal && (
        <AgentEditForm agent={agent} onClose={() => setShowEditModal(false)} />
      )}
    </>
  );
}
