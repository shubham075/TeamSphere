'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { MeetingJoin } from '@/components/meetings/meeting-join';

export default function MeetingPage() {
  return (
    <Suspense>
      <Page />
    </Suspense>
  );
}

function Page() {
  const { id } = useParams<{ id: string }>();
  const occurrence = useSearchParams().get('occurrence') ?? undefined;
  return <MeetingJoin id={id} occurrence={occurrence} />;
}
