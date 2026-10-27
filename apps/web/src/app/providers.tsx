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

  // Restore the session from the refresh cookie on first load. If the server is briefly down
  // (restart, deploy), keep retrying rather than sending the user to the sign-in page.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const attempt = () =>
      refreshSession()
        .then((s) => {
          if (!s) useAuth.getState().clear();
        })
        .catch(() => {
          timer = setTimeout(attempt, 3000);
        });
    void attempt();
    return () => clearTimeout(timer);
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
