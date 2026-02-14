'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [show, setShow] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('chitin_auth_token');
    if (token) {
      router.replace('/feed');
    } else {
      setShow(true);
    }
  }, [router]);

  if (!show) {
    return null;
  }

  return <main>{children}</main>;
}
