# Frontend Guide

The Aphorist frontend is built with Next.js 14 using the App Router.

## Technology Stack

- **Next.js 14** - React framework with App Router
- **React 18** - UI library
- **React Query** - Server state management
- **Tailwind CSS** - Utility-first styling
- **TypeScript** - Type safety

## Project Structure

```
apps/web/src/
├── app/                    # App Router pages
│   ├── layout.tsx          # Root layout
│   ├── page.tsx            # Home page
│   ├── providers.tsx       # Context providers
│   ├── globals.css         # Global styles
│   ├── auth/
│   │   ├── verify/         # Magic link verification
│   │   └── signup/         # User registration
│   └── post/
│       └── [id]/           # Post detail page
├── components/
│   ├── Argument/           # Argument analysis components
│   ├── Auth/               # Authentication components
│   ├── Feed/               # Feed display components
│   ├── Layout/             # Layout components
│   ├── Post/               # Post components
│   ├── Reply/              # Reply components
│   └── Vote/               # Voting components
├── contexts/
│   └── AuthContext.tsx     # Authentication state
├── hooks/                  # Custom React hooks
└── lib/
    ├── api.ts              # API client
    ├── config.ts           # Configuration
    └── utils.ts            # Utility functions
```

## Server vs Client Components

### Server Components (Default)

Used for data fetching and static rendering:

```tsx
// app/page.tsx
import { postsApi } from '@/lib/api';

export default async function HomePage() {
  // Server-side fetch
  const posts = await postsApi.getFeed('hot', 25);

  return (
    <FeedList initialData={posts} />
  );
}
```

### Client Components

Used for interactivity (marked with `'use client'`):

```tsx
// components/Vote/VoteButtons.tsx
'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';

export function VoteButtons({ targetId, score }) {
  const [optimisticScore, setOptimisticScore] = useState(score);

  // Interactive voting logic...
}
```

## State Management

### Auth State (Context)

Client-side authentication state:

```tsx
// contexts/AuthContext.tsx
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);

  // Initialize from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('chitin_auth_token');
    if (stored) {
      // Verify and set user...
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
```

### Server State (React Query)

Data fetching and caching:

```tsx
// components/Feed/FeedList.tsx
export function FeedList({ initialData, sort }) {
  const { data, fetchNextPage, hasNextPage } = useInfiniteQuery({
    queryKey: ['feed', sort],
    queryFn: ({ pageParam }) => postsApi.getFeed(sort, 25, pageParam),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.cursor,
    initialData: { pages: [initialData], pageParams: [undefined] },
  });

  // Render with infinite scroll...
}
```

## API Client

Type-safe API wrapper:

```tsx
// lib/api.ts
export const postsApi = {
  async getFeed(sort, limit, cursor, token) {
    const params = new URLSearchParams({ sort, limit: String(limit) });
    if (cursor) params.set('cursor', cursor);

    return apiRequest(`/api/v1/feed?${params}`, { token, revalidate: 60 });
  },

  async createPost(input, token) {
    return apiRequest('/api/v1/posts', {
      method: 'POST',
      body: input,
      token,
    });
  },
};
```

## Component Patterns

### Post Card

Display a post in the feed:

```tsx
// components/Post/PostCard.tsx
export function PostCard({ post }) {
  return (
    <article className="flex gap-4 p-4 border-b">
      <VoteButtons targetType="post" targetId={post.id} score={post.score} />

      <div className="flex-1">
        <Link href={`/post/${post.id}`} className="text-lg font-medium">
          {post.title}
        </Link>
        <p className="text-sm text-slate-600 line-clamp-2">
          {post.content}
        </p>
        <div className="text-xs text-slate-500">
          by {post.author.display_name} &middot; {formatDistanceToNow(post.created_at)}
        </div>
      </div>
    </article>
  );
}
```

### Optimistic Updates

Update UI before server response:

```tsx
// components/Vote/VoteButtons.tsx
const voteMutation = useMutation({
  mutationFn: async (value) => {
    // Optimistic update
    setOptimisticScore(s => s + value);
    setCurrentVote(value);

    await votesApi.vote({ target_type, target_id, value }, token);
  },
  onError: () => {
    // Revert on error
    setOptimisticScore(score);
    setCurrentVote(null);
  },
});
```

### Form Handling

Post composer example:

```tsx
// components/Post/PostComposer.tsx
export function PostComposer() {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  const mutation = useMutation({
    mutationFn: () => postsApi.createPost({ title, content }, token),
    onSuccess: () => {
      setTitle('');
      setContent('');
      queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }}>
      <input value={title} onChange={e => setTitle(e.target.value)} />
      <textarea value={content} onChange={e => setContent(e.target.value)} />
      <button disabled={mutation.isPending}>
        {mutation.isPending ? 'Posting...' : 'Post'}
      </button>
    </form>
  );
}
```

## Argument Analysis Components

The `Argument/` directory contains components for displaying ML-extracted argument structures.

### AnalysisStatusBadge

Shows the current analysis state of a post or reply:

```tsx
<AnalysisStatusBadge status="pending" />   // "Analyzing..."
<AnalysisStatusBadge status="completed" /> // "Analysis complete"
<AnalysisStatusBadge status="failed" />    // "Analysis failed"
```

### ArgumentHighlights

Renders post/reply content with inline ADU highlights. Claims and premises are marked with colored spans that users can click to see canonical claim details.

```tsx
<ArgumentHighlights
  content={post.content}
  adus={adus}                    // ADU[] from argumentApi.getPostADUs()
  canonicalMappings={mappings}   // From argumentApi.getCanonicalMappingsForPost()
/>
```

**ADU Type Colors:**
- **MajorClaim**: Blue background
- **Supporting**: Green background
- **Opposing**: Red background
- **Evidence**: Yellow background

### ClaimDeduplicationBadge

Shows when an ADU has been linked to a canonical claim shared across discussions:

```tsx
<ClaimDeduplicationBadge mapping={mapping} />
// Displays: "5 discussions share this claim"
```

### RelatedPostsList

Lists other posts/replies that contain the same canonical claim:

```tsx
<RelatedPostsList
  canonicalClaimId={claimId}
  excludeSourceId={currentPostId}
/>
```

## Argument API Client

The `argumentApi` namespace in `lib/api.ts` provides typed access to argument analysis endpoints:

```tsx
import { argumentApi } from '@/lib/api';

// Fetch ADUs for a post or reply
const adus = await argumentApi.getPostADUs(postId);
const replyAdus = await argumentApi.getReplyADUs(replyId);

// Fetch canonical claim mappings
const mappings = await argumentApi.getCanonicalMappingsForPost(postId);

// Fetch related posts sharing a canonical claim
const related = await argumentApi.getRelatedPostsForCanonicalClaim(claimId);

// Semantic search
const results = await argumentApi.semanticSearch('climate policy', 20);
```

## Styling with Tailwind

### Color Palette

```tsx
// Primary colors (blue)
className="text-primary-600 bg-primary-100 hover:bg-primary-700"

// Secondary colors (slate)
className="text-slate-600 bg-slate-100 dark:bg-slate-800"
```

### Dark Mode

Automatic based on system preference:

```css
/* globals.css */
@media (prefers-color-scheme: dark) {
  :root {
    --foreground-rgb: 248, 250, 252;
    --background-rgb: 15, 23, 42;
  }
}
```

### Responsive Design

Mobile-first approach:

```tsx
className="p-4 md:p-6 lg:p-8"
className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
```

## Infinite Scroll

Using react-virtuoso for performance:

```tsx
import { Virtuoso } from 'react-virtuoso';

<Virtuoso
  useWindowScroll
  data={allPosts}
  endReached={() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }}
  itemContent={(index, post) => <PostCard post={post} />}
/>
```

## Error Handling

Display errors gracefully:

```tsx
if (isError) {
  return (
    <div className="p-8 text-center text-red-500">
      Failed to load. Please try again.
    </div>
  );
}
```

## Testing (Future)

```bash
# Run tests
pnpm test

# Watch mode
pnpm test:watch
```
