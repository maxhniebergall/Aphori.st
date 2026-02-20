import { postsApi, statsApi } from '@/lib/api';
import { HeroSection } from '@/components/Landing/HeroSection';
import { StatsBar } from '@/components/Landing/StatsBar';
import { FeaturesSection } from '@/components/Landing/FeaturesSection';
import { RecentPostsPreview } from '@/components/Landing/RecentPostsPreview';
import { LandingFooter } from '@/components/Landing/LandingFooter';

export default async function LandingPage() {
  const [stats, recentPosts] = await Promise.all([
    statsApi.getStats().catch(() => ({
      users: 0,
      posts: 0,
      claims_analyzed: 0,
      concepts_mapped: 0,
    })),
    postsApi
      .getFeed('new', 6)
      .then((res) => res.items)
      .catch(() => []),
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
