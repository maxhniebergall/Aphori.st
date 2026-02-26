'use client';

import { useState, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { PostDetail } from './PostDetail';
import { ReplyThread } from '@/components/Reply/ReplyThread';
import { ReplyComposer } from '@/components/Reply/ReplyComposer';
import { useUserVotes } from '@/hooks/useUserVotes';
import { useV3Subgraph } from '@/hooks/useV3Subgraph';
import type { QuoteData } from '@/components/Shared/TextSelectionQuote';
import type { PostWithAuthor, ReplyWithAuthor, PaginatedResponse } from '@chitin/shared';

interface PostPageClientProps {
  post: PostWithAuthor;
  replies: PaginatedResponse<ReplyWithAuthor>;
}

export function PostPageClient({ post, replies }: PostPageClientProps) {
  const router = useRouter();
  const [activeQuote, setActiveQuote] = useState<QuoteData | null>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  const postVotes = useUserVotes('post', [post.id]);
  const replyIds = useMemo(
    () => replies.items.map((r) => r.id),
    [replies.items]
  );
  const replyVotes = useUserVotes('reply', replyIds);

  // V3 subgraph for the entire thread
  const { data: v3Subgraph } = useV3Subgraph(post.id);

  const handleQuote = useCallback((quote: QuoteData) => {
    setActiveQuote(quote);
    // Scroll to composer
    setTimeout(() => {
      composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  }, []);

  const handleSearch = useCallback((text: string) => {
    router.push(`/search?q=${encodeURIComponent(text)}`);
  }, [router]);

  const handleClearQuote = useCallback(() => {
    setActiveQuote(null);
  }, []);

  return (
    <div className="space-y-6">
      <PostDetail
        post={post}
        userVote={postVotes[post.id]}
        onQuote={handleQuote}
        onSearch={handleSearch}
        v3Subgraph={v3Subgraph}
      />

      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700">
        <div ref={composerRef}>
          <ReplyComposer
            postId={post.id}
            quote={activeQuote}
            onClearQuote={handleClearQuote}
          />
        </div>
        <ReplyThread
          postId={post.id}
          initialReplies={replies}
          userVotes={replyVotes}
          onQuote={handleQuote}
          onSearch={handleSearch}
          v3Subgraph={v3Subgraph}
        />
      </div>
    </div>
  );
}
