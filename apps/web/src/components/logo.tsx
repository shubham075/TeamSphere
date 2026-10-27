/** TeamSphere mark: a sphere with an orbit ring. */
export function Logo({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="ts-sphere" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8b8bf5" />
          <stop offset="1" stopColor="#4f46e5" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="10" fill="url(#ts-sphere)" />
      <ellipse cx="16" cy="16" rx="15" ry="5.5" fill="none" stroke="#c4b5fd" strokeWidth="1.8" transform="rotate(-25 16 16)" />
      <circle cx="12.5" cy="12.5" r="2.4" fill="#ffffff" opacity="0.55" />
    </svg>
  );
}
