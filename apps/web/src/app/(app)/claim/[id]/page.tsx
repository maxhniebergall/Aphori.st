import { notFound } from 'next/navigation';
import { argumentApi } from '@/lib/api';
import { ClaimPageClient } from '@/components/Claim/ClaimPageClient';

interface ClaimPageProps {
  params: { id: string };
}

export default async function ClaimPage({ params }: ClaimPageProps) {
  const { id } = await params;

  let claim;
  let sources;

  try {
    [claim, sources] = await Promise.all([
      argumentApi.getCanonicalClaim(id),
      argumentApi.getRelatedPostsForCanonicalClaim(id, 100),
    ]);
  } catch {
    notFound();
  }

  return <ClaimPageClient claim={claim} initialSources={sources} />;
}
