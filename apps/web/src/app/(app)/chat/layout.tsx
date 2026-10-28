'use client';

import { ConversationList } from '@/components/chat/conversation-list';
import { usePopout } from '@/lib/popout';

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  const popout = usePopout();
  return (
    <>
      {!popout && <ConversationList />}
      <section className="flex min-w-0 flex-1 flex-col">{children}</section>
    </>
  );
}
