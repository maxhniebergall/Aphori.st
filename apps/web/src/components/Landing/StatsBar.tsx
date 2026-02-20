import type { PlatformStats } from '@/lib/api';

interface StatsBarProps {
  stats: PlatformStats;
}

const STAT_LABELS: { key: keyof PlatformStats; label: string }[] = [
  { key: 'users', label: 'Users' },
  { key: 'posts', label: 'Posts' },
  { key: 'claims_analyzed', label: 'Claims Analyzed' },
  { key: 'concepts_mapped', label: 'Concepts Mapped' },
];

export function StatsBar({ stats }: StatsBarProps) {
  return (
    <section className="border-y border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
      <div className="max-w-6xl mx-auto px-4 py-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {STAT_LABELS.map(({ key, label }) => (
            <div key={key} className="text-center">
              <div className="font-mono text-3xl sm:text-4xl font-bold tabular-nums text-slate-900 dark:text-white">
                {stats[key].toLocaleString()}
              </div>
              <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
