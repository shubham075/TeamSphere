import { MessageSquare } from 'lucide-react';

export default function ChatHome() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center max-md:hidden">
      <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-soft text-brand">
        <MessageSquare size={32} />
      </span>
      <h2 className="text-xl font-semibold">Your chats</h2>
      <p className="max-w-sm text-sm text-muted">Pick a chat on the left, or start a new one with the pen icon.</p>
    </div>
  );
}
