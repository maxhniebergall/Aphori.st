import { ProfileClient } from '@/components/Profile/ProfileClient';

interface ProfilePageProps {
  params: Promise<{ id: string }>;
}

export default async function ProfilePage({ params }: ProfilePageProps) {
  const { id } = await params;

  return <ProfileClient userId={id} />;
}
