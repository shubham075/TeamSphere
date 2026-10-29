'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { CallManager } from '@/components/calls/call-manager';
import { DesktopIntegration } from '@/components/desktop-integration';
import { RealtimeProvider } from '@/components/realtime-provider';
import { FilesRealtime } from '@/components/files/files-realtime';
import { TeamsRealtime } from '@/components/teams/teams-realtime';
import { AppRail } from '@/components/shell/app-rail';
import { TitleBar } from '@/components/shell/title-bar';
import { Logo } from '@/components/logo';
import { useAuth } from '@/lib/auth-store';
import { usePopout } from '@/lib/popout';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const status = useAuth((s) => s.status);
  const router = useRouter();
  const pathname = usePathname();
  const popout = usePopout();

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

  if (popout) {
    return (
      <div className="flex h-full flex-col">
        <RealtimeProvider />
        <TeamsRealtime />
        <FilesRealtime />
        <main className="flex min-h-0 min-w-0 flex-1">{children}</main>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <DesktopIntegration />
      <RealtimeProvider />
      <CallManager />
      <TeamsRealtime />
      <FilesRealtime />
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <AppRail />
        <main className="flex min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
