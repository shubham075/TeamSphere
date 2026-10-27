import clsx from 'clsx';
import type { PresenceStatus } from '@teamsphere/shared';

const PALETTE = ['#5b5bd6', '#0f7b8a', '#b4467d', '#8a5a00', '#3b7d23', '#a4373a', '#6b4fbb', '#2b6cb0'];

function colorFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export const PRESENCE_COLOR: Record<PresenceStatus, string> = {
  available: 'var(--presence-available)',
  busy: 'var(--presence-busy)',
  dnd: 'var(--presence-busy)',
  in_call: 'var(--presence-busy)',
  in_meeting: 'var(--presence-busy)',
  presenting: 'var(--presence-busy)',
  brb: 'var(--presence-away)',
  away: 'var(--presence-away)',
  ooo: 'var(--presence-offline)',
  offline: 'var(--presence-offline)',
};

export function PresenceDot({
  status,
  size = 10,
  className,
}: {
  status: PresenceStatus;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={clsx('block rounded-full ring-2 ring-surface', className)}
      style={{ background: PRESENCE_COLOR[status], width: size, height: size }}
      aria-hidden="true"
    >
      {status === 'dnd' && <span className="mx-auto mt-[45%] block h-[12%] w-[55%] rounded bg-white" />}
    </span>
  );
}

export function Avatar({
  name,
  src,
  size = 32,
  presence,
}: {
  name: string;
  src?: string | null;
  size?: number;
  presence?: PresenceStatus;
}) {
  const dot = Math.max(8, Math.round(size * 0.32));
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full rounded-full object-cover" />
      ) : (
        <span
          className="flex h-full w-full items-center justify-center rounded-full font-semibold text-white"
          style={{ background: colorFor(name), fontSize: size * 0.38 }}
        >
          {initials(name)}
        </span>
      )}
      {presence && <PresenceDot status={presence} size={dot} className="absolute -right-0.5 -bottom-0.5" />}
    </span>
  );
}
