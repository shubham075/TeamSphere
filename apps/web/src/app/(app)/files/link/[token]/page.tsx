'use client';

import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { filesApi, itemPath } from '@/lib/files';

/** Organization-wide sharing link: registers the visit, then opens the item. */
export default function ShareLinkPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    filesApi
      .redeem(token)
      .then((item) => router.replace(itemPath(item)))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'This link doesn’t work'));
  }, [token, router]);

  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      {!error && <Loader2 className="animate-spin text-muted" />}
      {error && (
        <>
          <h1 className="text-xl font-semibold">This link doesn’t work</h1>
          <p className="text-sm text-muted">{error}</p>
          <Link href="/files" className="text-sm text-brand hover:underline">Go to My files</Link>
        </>
      )}
    </section>
  );
}
