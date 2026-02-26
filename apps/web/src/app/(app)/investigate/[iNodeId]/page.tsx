'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { v3Api } from '@/lib/api';
import type { InvestigateResponse } from '@/lib/api';

// ── Helpers ──────────────────────────────────────────────────────────────────

const EPISTEMIC_LABELS: Record<string, string> = {
  FACT: 'fact',
  VALUE: 'value',
  POLICY: 'policy',
};

// ── Sub-components ────────────────────────────────────────────────────────────

function GhostNodeCard({ ghost }: { ghost: InvestigateResponse['ghost_nodes'][number] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="p-4 mx-0 my-1 border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50/50 dark:bg-slate-800/30">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          Unstated assumption
        </span>
        <span className="text-[10px] text-slate-400 dark:text-slate-500">
          · {Math.round(ghost.probability * 100)}% likely
          · {ghost.scheme_direction === 'SUPPORT' ? 'in a supporting argument' : 'in an attacking argument'}
        </span>
      </div>

      {ghost.socratic_question && (
        <p className="text-xs text-slate-500 dark:text-slate-400 pl-3 border-l-2 border-slate-300 dark:border-slate-600 mb-2 italic">
          {ghost.socratic_question}
        </p>
      )}

      <p className="text-sm text-slate-700 dark:text-slate-300 italic">
        &ldquo;{ghost.content}&rdquo;
      </p>

      <div className="mt-2 flex items-center gap-3 text-xs">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 font-medium"
        >
          {expanded ? 'Hide options' : 'Engage with this assumption'}
        </button>
      </div>

      {expanded && (
        <div className="mt-2 flex gap-2 flex-wrap">
          <button className="text-xs px-2.5 py-1 bg-emerald-600 text-white rounded-full hover:bg-emerald-700 transition-colors">
            ✓ Verify
          </button>
          <button className="text-xs px-2.5 py-1 bg-red-600 text-white rounded-full hover:bg-red-700 transition-colors">
            ✗ Refute
          </button>
          <button className="text-xs px-2.5 py-1 bg-slate-600 text-white rounded-full hover:bg-slate-700 transition-colors">
            ~ Nuance
          </button>
        </div>
      )}
    </div>
  );
}

function ThreadNode({ node, rank }: {
  node: InvestigateResponse['synthetic_thread'][number];
  rank: number;
}) {
  const displayText = node.rewritten_text ?? node.content;
  const epistemicLabel = EPISTEMIC_LABELS[node.epistemic_type] ?? node.epistemic_type.toLowerCase();
  const isSupport = node.relation === 'SUPPORT';

  return (
    <div className="p-4 flex gap-3">
      {/* Rank + relation indicator */}
      <div className="flex-shrink-0 flex flex-col items-center gap-1 pt-0.5">
        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 w-5 text-center">
          {rank}
        </span>
        <div className={`w-0.5 flex-1 min-h-[24px] rounded-full ${isSupport ? 'bg-emerald-300 dark:bg-emerald-700' : 'bg-red-300 dark:bg-red-700'}`} />
      </div>

      <div className="flex-1 min-w-0">
        {/* Relation + type metadata */}
        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
          <span className={`text-[10px] font-semibold uppercase tracking-wider ${isSupport ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
            {isSupport ? 'Supporting' : 'Attacking'}
          </span>
          <span className="text-[10px] text-slate-400 dark:text-slate-500">·</span>
          <span className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider">
            {epistemicLabel}
          </span>
          {node.scheme_confidence > 0 && (
            <>
              <span className="text-[10px] text-slate-400 dark:text-slate-500">·</span>
              <span className="text-[10px] text-slate-400 dark:text-slate-500">
                {Math.round(node.scheme_confidence * 100)}% conf.
              </span>
            </>
          )}
        </div>

        {/* Content */}
        <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
          {displayText}
        </p>

        {/* Extracted values */}
        {node.extracted_values.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {node.extracted_values.map((v: string, i: number) => (
              <span
                key={i}
                className="text-[10px] px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded"
              >
                {v}
              </span>
            ))}
          </div>
        )}

        {/* Source + scores */}
        <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          {node.source_post_id && (
            <>
              <Link
                href={`/post/${node.source_post_id}`}
                className="hover:text-primary-600 dark:hover:text-primary-400 truncate max-w-[200px]"
              >
                {node.source_title ?? 'View post'}
              </Link>
              {node.source_author && (
                <>
                  <span>&middot;</span>
                  <span>by {node.source_author}</span>
                </>
              )}
            </>
          )}
          {(node.evidence_rank > 0 || node.hinge_centrality > 0) && (
            <>
              <span>&middot;</span>
              <span className="text-slate-400 dark:text-slate-500" title="Evidence Rank × Hinge Centrality">
                score {node.final_score.toFixed(2)}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="p-4 border-b border-slate-200 dark:border-slate-700">
        <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-24 mb-3" />
        <div className="h-5 bg-slate-200 dark:bg-slate-800 rounded w-3/4 mb-2" />
        <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-1/3" />
      </div>
      <div className="divide-y divide-slate-200 dark:divide-slate-700">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="p-4 flex gap-3">
            <div className="w-5 flex-shrink-0">
              <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded" />
            </div>
            <div className="flex-1 space-y-2">
              <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded w-32" />
              <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-full" />
              <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-5/6" />
              <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded w-40" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function InvestigatePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const iNodeId = params['iNodeId'] as string;
  const postId = searchParams.get('postId');

  const [data, setData] = useState<InvestigateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!iNodeId) return;
    let cancelled = false;

    setLoading(true);
    setError(null);

    v3Api.getInvestigate(iNodeId).then(result => {
      if (!cancelled) {
        setData(result);
        setLoading(false);
      }
    }).catch(err => {
      if (!cancelled) {
        setError(err?.message ?? 'Failed to load investigation');
        setLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, [iNodeId]);

  const supportCount = data?.synthetic_thread.filter((n: InvestigateResponse['synthetic_thread'][number]) => n.relation === 'SUPPORT').length ?? 0;
  const attackCount = data?.synthetic_thread.filter((n: InvestigateResponse['synthetic_thread'][number]) => n.relation === 'ATTACK').length ?? 0;

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="px-4 py-4 border-b border-slate-200 dark:border-slate-700">
        {postId && (
          <Link
            href={`/post/${postId}`}
            className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 mb-3"
          >
            ← Back to post
          </Link>
        )}
        <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Investigate</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Arguments from across the platform, ranked by evidence & structure
        </p>
      </div>

      {loading && <LoadingSkeleton />}

      {error && (
        <div className="p-4 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {data && (
        <>
          {/* Focal node */}
          <div className="p-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-primary-600 dark:text-primary-400">
                Focal claim
              </span>
              <span className="text-[10px] text-slate-400 dark:text-slate-500">
                · {EPISTEMIC_LABELS[data.focal_node.epistemic_type] ?? data.focal_node.epistemic_type.toLowerCase()}
                · {Math.round(data.focal_node.fvp_confidence * 100)}% confidence
              </span>
            </div>
            <p className="text-sm font-medium text-slate-800 dark:text-slate-200 leading-relaxed">
              {data.focal_node.rewritten_text ?? data.focal_node.content}
            </p>
            {data.focal_node.source_post_id && (
              <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <Link
                  href={`/post/${data.focal_node.source_post_id}`}
                  className="hover:text-primary-600 dark:hover:text-primary-400"
                >
                  {data.focal_node.source_title ?? 'View source post'}
                </Link>
                {data.focal_node.source_author && (
                  <>
                    <span>&middot;</span>
                    <span>by {data.focal_node.source_author}</span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Stats */}
          {data.synthetic_thread.length > 0 && (
            <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span>{data.total_related} argument{data.total_related !== 1 ? 's' : ''} found</span>
              <span>&middot;</span>
              <span className="text-emerald-600 dark:text-emerald-400">{supportCount} supporting</span>
              <span>&middot;</span>
              <span className="text-red-600 dark:text-red-400">{attackCount} attacking</span>
              {data.computation_metadata.clusters_formed > 1 && (
                <>
                  <span>&middot;</span>
                  <span>{data.computation_metadata.clusters_formed} viewpoint clusters</span>
                </>
              )}
            </div>
          )}

          {/* Ghost nodes */}
          {data.ghost_nodes.length > 0 && (
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Implicit assumptions
              </p>
              {data.ghost_nodes.map((ghost: InvestigateResponse['ghost_nodes'][number]) => (
                <GhostNodeCard key={ghost.id} ghost={ghost} />
              ))}
            </div>
          )}

          {/* Synthetic thread */}
          {data.synthetic_thread.length > 0 ? (
            <div className="divide-y divide-slate-200 dark:divide-slate-700">
              {data.synthetic_thread.map((node: InvestigateResponse['synthetic_thread'][number], i: number) => (
                <ThreadNode key={node.i_node_id} node={node} rank={i + 1} />
              ))}
            </div>
          ) : (
            <div className="p-8 text-center text-slate-500 dark:text-slate-400 text-sm">
              No arguments have been made about this claim yet.{' '}
              {data.focal_node.source_post_id && (
                <Link
                  href={`/post/${data.focal_node.source_post_id}`}
                  className="text-primary-600 dark:text-primary-400 hover:underline"
                >
                  Be the first to reply.
                </Link>
              )}
            </div>
          )}

          {/* Footer */}
          <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 text-[10px] text-slate-400 dark:text-slate-600">
            Ranked by EvidenceRank (BAF) × Hinge Centrality (Brandes'), K-Means diversity clustering · {data.computation_metadata.nodes_analyzed} nodes analyzed
          </div>
        </>
      )}
    </div>
  );
}
