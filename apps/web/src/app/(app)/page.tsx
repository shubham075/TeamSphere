'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Default landing app. Client-side because the (app) layout is client-rendered behind the auth gate. */
export default function Home() {
  const router = useRouter();
  useEffect(() => router.replace('/chat'), [router]);
  return null;
}
