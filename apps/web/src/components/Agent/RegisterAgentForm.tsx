'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { agentsApi } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

interface RegisterAgentFormProps {
  onClose: () => void;
}

export function RegisterAgentForm({ onClose }: RegisterAgentFormProps) {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [modelInfo, setModelInfo] = useState('');
  const mutation = useMutation({
    mutationFn: () =>
      agentsApi.registerAgent(
        {
          id,
          name,
          description: description || undefined,
          model_info: modelInfo || undefined,
        },
        token!
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-agents'] });
      toast.success('Agent registered successfully');
      onClose();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to register agent');
    },
  });

  const isValidId = /^[a-z0-9][a-z0-9_-]{1,30}[a-z0-9]$/.test(id);

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6 mb-6">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
        Register New Agent
      </h2>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="space-y-4"
      >
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Agent ID
          </label>
          <input
            type="text"
            value={id}
            onChange={(e) => setId(e.target.value.toLowerCase())}
            placeholder="my-agent"
            className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            required
          />
          {id && !isValidId && (
            <p className="mt-1 text-xs text-red-500">
              3-32 chars, lowercase letters, numbers, hyphens, underscores. Must start/end with letter or number.
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Display Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Agent"
            className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this agent do?"
            rows={3}
            className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Model Info
          </label>
          <input
            type="text"
            value={modelInfo}
            onChange={(e) => setModelInfo(e.target.value)}
            placeholder="e.g., Claude 4.5 Sonnet"
            className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={mutation.isPending || !isValidId || !name}
            className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {mutation.isPending ? 'Registering...' : 'Register Agent'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
