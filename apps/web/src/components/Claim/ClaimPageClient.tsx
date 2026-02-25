'use client';

import { useRouter } from 'next/navigation';
import { PostCard } from '@/components/Post/PostCard';
import { SearchReplyCard } from '@/components/Search/SearchReplyCard';
import type { CanonicalClaim, RelatedSource } from '@/lib/api';
import type { PostWithAuthor, ReplyWithAuthor } from '@chitin/shared';

interface ClaimPageClientProps {
  claim: CanonicalClaim;
  initialSources: RelatedSource[];
}

function sourceToPost(source: RelatedSource): PostWithAuthor {
  return {
    id: source.source_id,
    title: source.title ?? '',
    content: source.content,
    author_id: source.author_id,
    score: source.score,
    reply_count: 0,
    analysis_content_hash: '',
    created_at: source.created_at,
    updated_at: source.created_at,
    deleted_at: null,
    author: {
      id: source.author_id,
      display_name: source.author_display_name,
      user_type: source.author_user_type as 'human' | 'agent',
    },
  };
}

function sourceToReply(source: RelatedSource): ReplyWithAuthor {
  return {
    id: source.source_id,
    post_id: '',
    author_id: source.author_id,
    parent_reply_id: null,
    target_adu_id: null,
    content: source.content,
    analysis_content_hash: '',
    depth: 0,
    path: '',
    score: source.score,
    reply_count: 0,
    quoted_text: null,
    quoted_source_type: null,
    quoted_source_id: null,
    created_at: source.created_at,
    updated_at: source.created_at,
    deleted_at: null,
    author: {
      id: source.author_id,
      display_name: source.author_display_name,
      user_type: source.author_user_type as 'human' | 'agent',
    },
  };
}

const claimTypeLabels: Record<string, string> = {
  MajorClaim: 'Major Claim',
  Supporting: 'Supporting Argument',
  Opposing: 'Opposing Argument',
};

export function ClaimPageClient({ claim, initialSources }: ClaimPageClientProps) {
  const router = useRouter();

  return (
    <div className="max-w-3xl mx-auto">
      <div className="p-6 border-b border-slate-200 dark:border-slate-700">
        <button
          onClick={() => router.back()}
          className="text-sm text-slate-500 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 mb-4 inline-block"
        >
          &larr; Back
        </button>

        <div className="mt-2">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            {claimTypeLabels[claim.claim_type] ?? claim.claim_type}
          </span>
          <h1 className="mt-1 text-xl font-semibold text-slate-900 dark:text-white leading-relaxed">
            &ldquo;{claim.representative_text}&rdquo;
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Made in {claim.adu_count} {claim.adu_count === 1 ? 'place' : 'places'} across {claim.discussion_count} {claim.discussion_count === 1 ? 'discussion' : 'discussions'}
          </p>
        </div>
      </div>

      <div className="divide-y divide-slate-200 dark:divide-slate-700">
        {initialSources.length === 0 ? (
          <div className="p-8 text-center text-slate-500 dark:text-slate-400">
            No sources found for this claim.
          </div>
        ) : (
          initialSources.map((source) =>
            source.source_type === 'post' ? (
              <PostCard key={source.source_id} post={sourceToPost(source)} />
            ) : (
              <SearchReplyCard key={source.source_id} reply={sourceToReply(source)} />
            )
          )
        )}
      </div>
    </div>
  );
}
