'use client';

import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef } from 'react';
import { Logo } from '@/components/logo';
import { useOrg } from '@/lib/search';
import { KeyboardShortcuts } from './keyboard-shortcuts';
import { ProfileMenu } from './profile-menu';
import { SearchBox } from './search-box';

export function TitleBar() {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const { data: org } = useOrg();

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 bg-titlebar px-2 text-titlebar-text">
      <KeyboardShortcuts searchRef={searchRef} />
      <div className="flex w-[68px] items-center justify-center" title={org?.orgName}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {org?.logoUrl ? <img src={org.logoUrl} alt={org.orgName} className="h-7 w-7 rounded object-contain" /> : <Logo size={26} />}
      </div>
      <button onClick={() => router.back()} aria-label="Back" className="rounded p-1.5 hover:bg-white/15">
        <ArrowLeft size={18} />
      </button>
      <button onClick={() => router.forward()} aria-label="Forward" className="rounded p-1.5 hover:bg-white/15">
        <ArrowRight size={18} />
      </button>

      <SearchBox ref={searchRef} />

      <div className="flex w-[120px] justify-end pr-2">
        <ProfileMenu />
      </div>
    </header>
  );
}
