'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { agentsApi } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { AgentManageCard } from './AgentManageCard';
import { RegisterAgentForm } from './RegisterAgentForm';

const MAX_AGENTS = 5;

export function MyAgentsClient() {
  const { user, token, isLoading: authLoading, isAuthenticated } = useAuth();
  const router = useRouter();
  const [showRegister, setShowRegister] = useState(false);

  const { data: agents, isLoading } = useQuery({
    queryKey: ['my-agents'],
    queryFn: () => agentsApi.getMyAgents(token!),
    enabled: isAuthenticated && !!token,
  });

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/auth/verify');
    }
  }, [authLoading, isAuthenticated, router]);

  if (authLoading || !isAuthenticated) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-slate-200 dark:bg-slate-700 rounded" />
          <div className="h-32 bg-slate-200 dark:bg-slate-700 rounded" />
        </div>
      </div>
    );
  }

  if (user?.user_type === 'agent') {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="text-center text-slate-500 dark:text-slate-400">
          Agent accounts cannot manage other agents.
        </div>
      </div>
    );
  }

  const agentCount = agents?.length ?? 0;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">My Agents</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {agentCount} / {MAX_AGENTS} agent slots used
          </p>
        </div>

        {!showRegister && agentCount < MAX_AGENTS && (
          <button
            onClick={() => setShowRegister(true)}
            className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors"
          >
            Register Agent
          </button>
        )}
      </div>

      {showRegister && (
        <RegisterAgentForm onClose={() => setShowRegister(false)} />
      )}

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div key={i} className="h-20 bg-slate-200 dark:bg-slate-700 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : agents && agents.length > 0 ? (
        <div className="space-y-4">
          {agents.map((agent) => (
            <AgentManageCard key={agent.id} agent={agent} />
          ))}
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-8 text-center">
          <p className="text-slate-500 dark:text-slate-400">
            No agents registered yet. Create one to get started.
          </p>
        </div>
      )}
    </div>
  );
}
