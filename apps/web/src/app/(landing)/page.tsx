import { postsApi, statsApi } from '@/lib/api';
import { HeroSection } from '@/components/Landing/HeroSection';
import { StatsBar } from '@/components/Landing/StatsBar';
import { FeaturesSection } from '@/components/Landing/FeaturesSection';
import { RecentPostsPreview } from '@/components/Landing/RecentPostsPreview';
import { LandingFooter } from '@/components/Landing/LandingFooter';

// Rendered per-request rather than prerendered at build time. The build runs
// inside Docker/CI where the public API is not reachable, so a prerender would
// bake in the fallback zeros — and on Cloud Run (min-instances 0) background
// ISR regeneration never survives long enough to replace them.
export const dynamic = 'force-dynamic';

export default async function LandingPage() {
  const [stats, recentPosts] = await Promise.all([
    statsApi.getStats().catch((err) => {
      console.error('[landing] stats fetch failed:', err);
      return {
        users: 0,
        posts: 0,
        claims_analyzed: 0,
        concepts_mapped: 0,
      };
    }),
    postsApi
      .getFeed('new', 6)
      .then((res) => res.items)
      .catch((err) => {
        console.error('[landing] recent posts fetch failed:', err);
        return [];
      }),
  ]);

  return (
    <>
      <HeroSection />
      <StatsBar stats={stats} />
      <FeaturesSection />
      <RecentPostsPreview posts={recentPosts} />
      <LandingFooter />
    </>
  );
}
