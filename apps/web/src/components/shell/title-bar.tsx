'use client';

import { ArrowLeft, ArrowRight, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { Logo } from '@/components/logo';
import { ProfileMenu } from './profile-menu';

export function TitleBar() {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);

  // Ctrl+E / Ctrl+K focus the search & command box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'e' || e.key === 'k')) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 bg-titlebar px-2 text-titlebar-text">
      <div className="flex w-[68px] items-center justify-center">
        <Logo size={26} />
      </div>
      <button onClick={() => router.back()} aria-label="Back" className="rounded p-1.5 hover:bg-white/15">
        <ArrowLeft size={18} />
      </button>
      <button onClick={() => router.forward()} aria-label="Forward" className="rounded p-1.5 hover:bg-white/15">
        <ArrowRight size={18} />
      </button>

      <div className="mx-auto flex w-full max-w-xl items-center gap-2 rounded-md bg-white/15 px-3 py-1.5 focus-within:bg-white focus-within:text-[#1f1f2b]">
        <Search size={16} className="shrink-0 opacity-80" />
        <input
          ref={searchRef}
          placeholder="Search (Ctrl+E)"
          aria-label="Search"
          className="w-full bg-transparent text-sm outline-none placeholder:text-current placeholder:opacity-75"
        />
      </div>

      <div className="flex w-[120px] justify-end pr-2">
        <ProfileMenu />
      </div>
    </header>
  );
}
