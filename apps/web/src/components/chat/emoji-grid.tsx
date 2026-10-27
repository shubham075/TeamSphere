const EMOJIS = [
  '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🙂', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😋',
  '😜', '🤪', '🤗', '🤔', '🤨', '😐', '😑', '😶', '🙄', '😏', '😬', '😌', '😴', '😷', '🤒', '🤯',
  '😎', '🤓', '😕', '😟', '😮', '😲', '😳', '🥺', '😢', '😭', '😱', '😤', '😡', '🤬', '👍', '👎',
  '👏', '🙌', '🙏', '🤝', '💪', '👀', '👋', '✌️', '🤞', '👌', '❤️', '🧡', '💛', '💚', '💙', '💜',
  '🔥', '✨', '🎉', '🎊', '💯', '✅', '❌', '⚠️', '❓', '💡', '📌', '📎', '📅', '⏰', '☕', '🍕',
  '🚀', '⭐', '🏆', '🎯', '💼', '📈', '📉', '🐛', '🛠️', '📝', '💬', '📣', '🔔', '🌟', '🙈', '🤷',
];

export function EmojiGrid({ onPick }: { onPick: (emoji: string) => void }) {
  return (
    <div role="listbox" aria-label="Emoji" className="grid w-[300px] grid-cols-8 gap-0.5 rounded-lg border border-border bg-surface p-2 shadow-xl">
      {EMOJIS.map((e) => (
        <button key={e} role="option" aria-selected={false} onClick={() => onPick(e)} className="rounded p-1 text-lg hover:bg-surface-hover">
          {e}
        </button>
      ))}
    </div>
  );
}
