'use client';

import clsx from 'clsx';

/** Small building blocks shared by the admin center sections. */

export function Panel({ title, actions, children }: { title: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="mb-4 flex items-center gap-3">
        <h2 className="flex-1 text-base font-semibold">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Btn({ variant = 'default', className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'danger' }) {
  return (
    <button
      {...props}
      className={clsx(
        'rounded-md px-3 py-1.5 text-sm disabled:opacity-50',
        variant === 'primary' && 'bg-brand font-semibold text-brand-text hover:bg-brand-hover',
        variant === 'danger' && 'border border-danger text-danger hover:bg-danger hover:text-white',
        variant === 'default' && 'border border-border hover:bg-surface-hover',
        className,
      )}
    />
  );
}

export function Toggle({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex items-start gap-3 py-1.5 text-sm">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--brand)]" />
      <span>
        <span className="block">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx('rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm', props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={clsx('rounded-md border border-border bg-surface px-2 py-1.5 text-sm', props.className)} />;
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-danger">
      {error instanceof Error ? error.message : String(error)}
    </p>
  );
}

export function Badge({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'brand' | 'danger' }) {
  return (
    <span
      className={clsx(
        'rounded px-1.5 py-0.5 text-[11px] font-semibold',
        tone === 'muted' && 'bg-surface-2 text-muted',
        tone === 'brand' && 'bg-brand-soft text-brand',
        tone === 'danger' && 'bg-danger/15 text-danger',
      )}
    >
      {children}
    </span>
  );
}
