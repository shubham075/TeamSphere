import { ConversationList } from '@/components/chat/conversation-list';

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ConversationList />
      <section className="flex min-w-0 flex-1 flex-col">{children}</section>
    </>
  );
}
