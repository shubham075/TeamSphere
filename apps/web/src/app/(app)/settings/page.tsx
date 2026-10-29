'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Monitor, Moon, Sun } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import type {
  DesktopSettings, OutOfOfficeSettings, PublicUser, SessionInfo, UpdateProfileInput, UpdateStatus,
} from '@teamsphere/shared';
import { Avatar } from '@/components/avatar';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { getDesktop } from '@/lib/desktop';
import { Me, useMe } from '@/lib/presence';
import { getThemePref, setThemePref, ThemePref } from '@/lib/theme';

const SECTIONS = ['General', 'Profile', 'Privacy & devices', 'Desktop app', 'Administration'] as const;
type Section = (typeof SECTIONS)[number];

export default function SettingsPage() {
  const { data: me } = useMe();
  const [section, setSection] = useState<Section>('General');
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => setIsDesktop(!!getDesktop()), []);
  if (!me) return null;
  const sections = SECTIONS.filter(
    (s) => (s !== 'Administration' || me.role === 'admin') && (s !== 'Desktop app' || isDesktop),
  );

  return (
    <>
      <aside className="w-64 shrink-0 border-r border-border bg-surface">
        <h1 className="px-5 pt-4 pb-3 text-xl font-semibold">Settings</h1>
        <nav className="flex flex-col px-2">
          {sections.map((s) => (
            <button
              key={s}
              onClick={() => setSection(s)}
              className={clsx(
                'rounded-md px-3 py-2 text-left text-sm',
                section === s ? 'bg-brand-soft font-semibold text-brand' : 'hover:bg-surface-hover',
              )}
            >
              {s}
            </button>
          ))}
        </nav>
      </aside>
      <div className="flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-2xl space-y-8">
          {section === 'General' && <GeneralSettings />}
          {section === 'Profile' && <ProfileSettings me={me} />}
          {section === 'Privacy & devices' && <DeviceSettings me={me} />}
          {section === 'Desktop app' && <DesktopAppSettings />}
          {section === 'Administration' && <AdminUsers />}
        </div>
      </div>
    </>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-6">
      <h2 className="mb-4 text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Field(props: { label: string; value: string; onChange?: (v: string) => void; disabled?: boolean; type?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{props.label}</span>
      <input
        type={props.type ?? 'text'}
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange?.(e.target.value)}
        className="rounded-md border border-border bg-surface px-3 py-2 outline-none focus:border-brand disabled:bg-surface-2 disabled:text-muted"
      />
    </label>
  );
}

function Notice({ error, ok }: { error?: string | null; ok?: string | null }) {
  if (error) return <p role="alert" className="text-sm text-danger">{error}</p>;
  if (ok) return <p role="status" className="text-sm text-success">{ok}</p>;
  return null;
}

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : e ? 'Something went wrong' : null);

function GeneralSettings() {
  const [theme, setTheme] = useState<ThemePref>('system');
  useEffect(() => setTheme(getThemePref()), []);
  const options: { id: ThemePref; label: string; icon: typeof Sun }[] = [
    { id: 'system', label: 'System', icon: Monitor },
    { id: 'light', label: 'Light', icon: Sun },
    { id: 'dark', label: 'Dark', icon: Moon },
  ];
  return (
    <Card title="Theme">
      <div role="radiogroup" className="grid grid-cols-3 gap-3">
        {options.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="radio"
            aria-checked={theme === id}
            onClick={() => {
              setTheme(id);
              setThemePref(id);
            }}
            className={clsx(
              'flex flex-col items-center gap-2 rounded-lg border p-4 text-sm',
              theme === id ? 'border-brand bg-brand-soft font-semibold' : 'border-border hover:bg-surface-hover',
            )}
          >
            <Icon size={22} />
            {label}
          </button>
        ))}
      </div>
    </Card>
  );
}

function ProfileSettings({ me }: { me: Me }) {
  const qc = useQueryClient();
  const setUser = useAuth((s) => s.setUser);
  const directory = me.authProvider !== 'local';
  const [form, setForm] = useState({
    displayName: me.displayName,
    jobTitle: me.jobTitle ?? '',
    department: me.department ?? '',
    office: me.office ?? '',
    phone: me.phone ?? '',
    email: me.email ?? '',
  });
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const body: UpdateProfileInput = {
        displayName: form.displayName,
        jobTitle: form.jobTitle || null,
        department: form.department || null,
        office: form.office || null,
        phone: form.phone || null,
        email: form.email || null,
      };
      return api<PublicUser>('/users/me', { method: 'PATCH', json: body });
    },
    onSuccess: (user) => {
      setUser(user);
      qc.setQueryData<Me>(['me'], (old) => (old ? { ...old, ...user } : old));
    },
  });

  return (
    <>
      <Card title="Profile">
        <div className="mb-6 flex items-center gap-4">
          <Avatar name={form.displayName || me.displayName} src={me.avatarUrl} size={64} />
          <div>
            <p className="font-semibold">{me.username}</p>
            <p className="text-sm text-muted">
              {directory
                ? `Signed in with ${me.authProvider === 'entra' ? 'Microsoft Entra ID' : 'the company directory'}. Directory fields refresh at each sign-in.`
                : 'TeamSphere account'}
            </p>
            <AvatarControls me={me} />
          </div>
        </div>
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            save.mutate();
          }}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        >
          <Field label="Display name" value={form.displayName} onChange={set('displayName')} disabled={directory} />
          <Field label="Email" type="email" value={form.email} onChange={set('email')} disabled={directory} />
          <Field label="Job title" value={form.jobTitle} onChange={set('jobTitle')} disabled={directory} />
          <Field label="Department" value={form.department} onChange={set('department')} disabled={directory} />
          <Field label="Office" value={form.office} onChange={set('office')} disabled={directory} />
          <Field label="Phone" value={form.phone} onChange={set('phone')} disabled={directory} />
          {!directory && (
            <div className="flex items-center gap-4 sm:col-span-2">
              <button
                disabled={save.isPending}
                className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-hover disabled:opacity-60"
              >
                Save changes
              </button>
              <Notice error={errorText(save.error)} ok={save.isSuccess ? 'Saved' : null} />
            </div>
          )}
        </form>
      </Card>
      <OutOfOfficeCard />
      {!directory && <PasswordCard />}
    </>
  );
}

function AvatarControls({ me }: { me: Me }) {
  const qc = useQueryClient();
  const setUser = useAuth((s) => s.setUser);
  const apply = (user: PublicUser) => {
    setUser(user);
    qc.setQueryData<Me>(['me'], (old) => (old ? { ...old, ...user } : old));
    // Avatars appear in chat lists and messages too.
    void qc.invalidateQueries({ queryKey: ['conversations'] });
  };
  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api<PublicUser>('/users/me/avatar', { method: 'PUT', body: form });
    },
    onSuccess: apply,
  });
  const remove = useMutation({ mutationFn: () => api<PublicUser>('/users/me/avatar', { method: 'DELETE' }), onSuccess: apply });

  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
      <label className="cursor-pointer font-semibold text-brand hover:underline focus-within:underline">
        {upload.isPending ? 'Uploading…' : me.avatarUrl ? 'Change picture' : 'Upload picture'}
        <input
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload.mutate(file);
            e.target.value = '';
          }}
        />
      </label>
      {me.avatarUrl && (
        <button onClick={() => remove.mutate()} className="text-muted hover:text-danger hover:underline">
          Remove
        </button>
      )}
      <Notice error={errorText(upload.error ?? remove.error)} />
    </div>
  );
}

/** Value for <input type="datetime-local"> from an ISO string, in local time. */
const toLocalInput = (iso: string | null) =>
  iso ? new Date(new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '';

function OutOfOfficeCard() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['out-of-office'], queryFn: () => api<OutOfOfficeSettings>('/users/me/out-of-office') });
  const [form, setForm] = useState({ enabled: false, message: '', scheduled: false, startAt: '', endAt: '' });
  useEffect(() => {
    if (data) {
      setForm({
        enabled: data.enabled,
        message: data.message ?? '',
        scheduled: !!(data.startAt || data.endAt),
        startAt: toLocalInput(data.startAt),
        endAt: toLocalInput(data.endAt),
      });
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      api<OutOfOfficeSettings>('/users/me/out-of-office', {
        method: 'PUT',
        json: {
          enabled: form.enabled,
          message: form.message.trim() || null,
          startAt: form.scheduled && form.startAt ? new Date(form.startAt).toISOString() : null,
          endAt: form.scheduled && form.endAt ? new Date(form.endAt).toISOString() : null,
        },
      }),
    onSuccess: (s) => {
      qc.setQueryData(['out-of-office'], s);
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });

  return (
    <Card title="Out of office">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        className="space-y-4"
      >
        <Toggle
          label="Turn on automatic replies"
          hint="People who message you see that you're away, and get your message as a reply once a day."
          checked={form.enabled}
          onChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
        />
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Message</span>
          <textarea
            value={form.message}
            onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
            maxLength={1000}
            rows={3}
            placeholder="I'm away until Monday. For urgent matters contact…"
            className="rounded-md border border-border bg-surface px-3 py-2 outline-none focus:border-brand"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.scheduled} onChange={(e) => setForm((f) => ({ ...f, scheduled: e.target.checked }))} className="accent-brand" />
          Only during a time period
        </label>
        {form.scheduled && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Start" type="datetime-local" value={form.startAt} onChange={(v) => setForm((f) => ({ ...f, startAt: v }))} />
            <Field label="End" type="datetime-local" value={form.endAt} onChange={(v) => setForm((f) => ({ ...f, endAt: v }))} />
          </div>
        )}
        <div className="flex items-center gap-4">
          <button disabled={save.isPending} className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-hover disabled:opacity-60">
            Save
          </button>
          <Notice error={errorText(save.error)} ok={save.isSuccess ? 'Saved' : null} />
        </div>
      </form>
    </Card>
  );
}

function PasswordCard() {
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const change = useMutation({
    mutationFn: () => api('/users/me/password', { method: 'POST', json: { currentPassword, newPassword } }),
    onSuccess: () => {
      setCurrent('');
      setNew('');
    },
  });
  return (
    <Card title="Change password">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          change.mutate();
        }}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      >
        <Field label="Current password" type="password" value={currentPassword} onChange={setCurrent} />
        <Field label="New password (8+ characters)" type="password" value={newPassword} onChange={setNew} />
        <div className="flex items-center gap-4 sm:col-span-2">
          <button
            disabled={change.isPending || !currentPassword || newPassword.length < 8}
            className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-hover disabled:opacity-60"
          >
            Update password
          </button>
          <Notice
            error={errorText(change.error)}
            ok={change.isSuccess ? 'Password changed. Other devices were signed out.' : null}
          />
        </div>
      </form>
    </Card>
  );
}

function describeAgent(ua: string | null) {
  if (!ua) return 'Unknown device';
  const app = ua.includes('Electron') ? 'TeamSphere desktop' : ua.includes('Edg/') ? 'Edge' : ua.includes('Chrome') ? 'Chrome' : ua.includes('Firefox') ? 'Firefox' : ua.includes('Safari') ? 'Safari' : 'Browser';
  const os = ua.includes('Windows') ? 'Windows' : ua.includes('Mac OS') ? 'macOS' : ua.includes('Android') ? 'Android' : ua.includes('iPhone') ? 'iOS' : ua.includes('Linux') ? 'Linux' : '';
  return os ? `${app} on ${os}` : app;
}

function DeviceSettings({ me }: { me: Me }) {
  const qc = useQueryClient();
  const { data: sessions } = useQuery({
    queryKey: ['sessions', me.id],
    queryFn: () => api<SessionInfo[]>('/auth/sessions'),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/auth/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  });
  const revokeOthers = useMutation({
    mutationFn: () => api('/auth/sessions/revoke-others', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  });

  return (
    <Card title="Signed-in devices">
      <ul className="divide-y divide-border">
        {sessions?.map((s) => (
          <li key={s.id} className="flex items-center gap-4 py-3 text-sm">
            <div className="flex-1">
              <p className="font-medium">
                {describeAgent(s.userAgent)} {s.current && <span className="ml-1 text-xs text-success">· This device</span>}
              </p>
              <p className="text-xs text-muted">
                {s.ip ?? 'Unknown IP'} · last active {new Date(s.lastUsedAt).toLocaleString()}
              </p>
            </div>
            {!s.current && (
              <button
                onClick={() => revoke.mutate(s.id)}
                className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-hover"
              >
                Sign out
              </button>
            )}
          </li>
        ))}
      </ul>
      {(sessions?.length ?? 0) > 1 && (
        <button
          onClick={() => revokeOthers.mutate()}
          className="mt-4 rounded-md border border-border px-3 py-2 text-sm hover:bg-surface-hover"
        >
          Sign out all other devices
        </button>
      )}
    </Card>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-6 py-3 text-sm">
      <span>
        <span className="block font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-4 w-4 accent-brand" />
    </label>
  );
}

const UPDATE_TEXT: Record<UpdateStatus['state'], string> = {
  disabled: 'Updates are checked only in installed builds.',
  checking: 'Checking for updates…',
  none: 'You have the latest version.',
  downloading: 'Downloading an update…',
  ready: 'An update is ready.',
  error: 'Update check failed.',
};

function DesktopAppSettings() {
  const desktop = getDesktop()!;
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [update, setUpdate] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    void desktop.getSettings().then(setSettings);
    return desktop.onUpdateStatus(setUpdate);
  }, [desktop]);

  if (!settings) return null;
  const patch = (p: Partial<Omit<DesktopSettings, 'serverUrl'>>) => void desktop.updateSettings(p).then(setSettings);

  return (
    <>
      <Card title="Startup & window">
        <div className="divide-y divide-border">
          <Toggle
            label="Open TeamSphere when I sign in to Windows"
            checked={settings.openAtLogin}
            onChange={(v) => patch({ openAtLogin: v })}
          />
          <Toggle
            label="Start minimized"
            hint="When opened at sign-in, start in the system tray."
            checked={settings.startMinimized}
            onChange={(v) => patch({ startMinimized: v })}
          />
          <Toggle
            label="Keep running when I close the window"
            hint="You'll keep receiving calls and notifications. Quit from the tray icon."
            checked={settings.closeToTray}
            onChange={(v) => patch({ closeToTray: v })}
          />
        </div>
      </Card>
      <Card title="Server">
        <p className="mb-4 text-sm">
          Connected to <strong>{settings.serverUrl}</strong>
        </p>
        <button
          onClick={() => desktop.changeServer()}
          className="rounded-md border border-border px-3 py-2 text-sm hover:bg-surface-hover"
        >
          Change server
        </button>
      </Card>
      <Card title="About">
        <p className="text-sm">TeamSphere for Windows, version {desktop.version}</p>
        <p className="mt-1 text-sm text-muted">
          {update ? UPDATE_TEXT[update.state] : ''}
          {update?.state === 'error' && ` ${update.message}`}
        </p>
        <div className="mt-4 flex gap-3">
          <button
            onClick={() => void desktop.checkForUpdates().then(setUpdate)}
            className="rounded-md border border-border px-3 py-2 text-sm hover:bg-surface-hover"
          >
            Check for updates
          </button>
          {update?.state === 'ready' && (
            <button
              onClick={() => desktop.installUpdate()}
              className="rounded-md bg-brand px-3 py-2 text-sm font-semibold text-brand-text hover:bg-brand-hover"
            >
              Restart to update to {update.version}
            </button>
          )}
        </div>
      </Card>
    </>
  );
}

function AdminUsers() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const { data: users } = useQuery({
    queryKey: ['admin-users', q],
    queryFn: () => api<PublicUser[]>(`/users?take=100&includeInactive=1&q=${encodeURIComponent(q)}`),
  });
  const [form, setForm] = useState({ username: '', displayName: '', email: '', password: '', role: 'user' });
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const create = useMutation({
    mutationFn: () => api<PublicUser>('/users', { method: 'POST', json: { ...form, email: form.email || undefined } }),
    onSuccess: () => {
      setForm({ username: '', displayName: '', email: '', password: '', role: 'user' });
      qc.invalidateQueries({ queryKey: ['admin-users'] });
    },
  });
  const toggle = useMutation({
    mutationFn: (u: PublicUser) => api(`/users/${u.id}/active`, { method: 'PATCH', json: { isActive: !u.isActive } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });
  const reset = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      api(`/users/${id}/password`, { method: 'POST', json: { password } }),
  });

  return (
    <>
      <Card title="Add a TeamSphere account">
        <p className="mb-4 text-sm text-muted">
          People who sign in with Microsoft Entra ID or the company directory are created automatically on first sign-in.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        >
          <Field label="Username" value={form.username} onChange={set('username')} />
          <Field label="Display name" value={form.displayName} onChange={set('displayName')} />
          <Field label="Email (optional)" type="email" value={form.email} onChange={set('email')} />
          <Field label="Temporary password" type="password" value={form.password} onChange={set('password')} />
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Role</span>
            <select
              value={form.role}
              onChange={(e) => set('role')(e.target.value)}
              className="rounded-md border border-border bg-surface px-3 py-2"
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
              <option value="guest">Guest</option>
            </select>
          </label>
          <div className="flex items-end gap-4">
            <button
              disabled={create.isPending}
              className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-hover disabled:opacity-60"
            >
              Create account
            </button>
          </div>
          <div className="sm:col-span-2">
            <Notice error={errorText(create.error)} ok={create.isSuccess ? 'Account created' : null} />
          </div>
        </form>
      </Card>

      <Card title="People">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search people"
          aria-label="Search people"
          className="mb-3 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <ul className="divide-y divide-border">
          {users?.map((u) => (
            <li key={u.id} className="flex items-center gap-3 py-2.5 text-sm">
              <Avatar name={u.displayName} src={u.avatarUrl} size={32} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{u.displayName}</p>
                <p className="truncate text-xs text-muted">
                  {u.username} · {u.role} · {u.authProvider}
                  {!u.isActive && <span className="ml-1 font-semibold text-danger">· disabled</span>}
                </p>
              </div>
              {u.authProvider === 'local' && (
                <button
                  onClick={() => {
                    const password = prompt(`New temporary password for ${u.displayName} (8+ characters):`);
                    if (password) reset.mutate({ id: u.id, password });
                  }}
                  className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-hover"
                >
                  Reset password
                </button>
              )}
              <button
                onClick={() => toggle.mutate(u)}
                className={clsx('rounded-md border px-3 py-1.5 hover:bg-surface-hover', u.isActive ? 'border-border' : 'border-brand text-brand')}
              >
                {u.isActive ? 'Disable' : 'Enable'}
              </button>
            </li>
          ))}
        </ul>
        <Notice error={errorText(toggle.error ?? reset.error)} ok={reset.isSuccess ? 'Password reset. Their other sessions were signed out.' : null} />
      </Card>
    </>
  );
}
