import { ProfileClient } from '@/components/Profile/ProfileClient';

interface ProfilePageProps {
  params: { id: string };
}

export default function ProfilePage({ params }: ProfilePageProps) {
  const { id } = params;

  return <ProfileClient userId={id} />;
}
