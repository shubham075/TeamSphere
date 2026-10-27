'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { refreshSession } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { applyTheme, getThemePref } from '@/lib/theme';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }),
  );

  // Restore the session from the refresh cookie on first load.
  useEffect(() => {
    refreshSession().then((s) => {
      if (!s) useAuth.getState().clear();
    });
  }, []);

  // Follow OS theme changes when the preference is "system".
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme(getThemePref());
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
