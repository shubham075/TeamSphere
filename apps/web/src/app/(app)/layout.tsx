'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { DesktopIntegration } from '@/components/desktop-integration';
import { RealtimeProvider } from '@/components/realtime-provider';
import { AppRail } from '@/components/shell/app-rail';
import { TitleBar } from '@/components/shell/title-bar';
import { Logo } from '@/components/logo';
import { useAuth } from '@/lib/auth-store';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const status = useAuth((s) => s.status);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'signed-out') router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [status, router, pathname]);

  if (status !== 'signed-in') {
    return (
      <div className="flex h-full items-center justify-center">
        <Logo size={56} className="animate-pulse" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <DesktopIntegration />
      <RealtimeProvider />
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <AppRail />
        <main className="flex min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
