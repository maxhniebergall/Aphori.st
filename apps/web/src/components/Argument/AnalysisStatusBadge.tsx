'use client';

import { type AnalysisStatus } from '@chitin/shared';

interface AnalysisStatusBadgeProps {
  status: AnalysisStatus;
}

function SpinnerIcon() {
  return (
    <svg
      className="animate-spin h-3 w-3"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

const statusConfig: Record<
  AnalysisStatus,
  { label: string; color: string; spinner?: boolean }
> = {
  pending: {
    label: 'Queued for analysis',
    color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  },
  processing: {
    label: 'Analyzing arguments...',
    color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    spinner: true,
  },
  completed: {
    label: 'Analysis complete',
    color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  },
  failed: {
    label: 'Analysis failed',
    color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  },
};

export function AnalysisStatusBadge({ status }: AnalysisStatusBadgeProps) {
  if (status === 'completed') {
    return null;
  }

  const config = statusConfig[status];

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded ${config.color}`}
    >
      {config.spinner && <SpinnerIcon />}
      {config.label}
    </div>
  );
}
