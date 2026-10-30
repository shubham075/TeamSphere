'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import type { AdminUpdateUserInput, AdminUserRow, EffectivePolicySource, UserRole } from '@teamsphere/shared';
import { Avatar } from '@/components/avatar';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/i18n';
import { Badge, Btn, ErrorText, Input, Panel, Select } from './ui';

/** Users (or just guests): search, create, role, enable/disable, reset password, effective policies. */
export function AdminUsers({ guestsOnly = false }: { guestsOnly?: boolean }) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const key = ['admin', 'users', q, status, guestsOnly];
  const { data: users, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => api<AdminUserRow[]>(`/admin/users?q=${encodeURIComponent(q)}&status=${status}${guestsOnly ? '&role=guest' : ''}`),
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: AdminUpdateUserInput }) => api<AdminUserRow>(`/admin/users/${id}`, { method: 'PATCH', json: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });

  return (
    <Panel
      title={guestsOnly ? 'Guests' : 'Users'}
      actions={<Btn variant="primary" onClick={() => setCreating((c) => !c)}>{creating ? 'Cancel' : guestsOnly ? 'Add guest' : 'Add user'}</Btn>}
    >
      {creating && <CreateUser defaultRole={guestsOnly ? 'guest' : 'user'} onDone={() => setCreating(false)} />}
      <div className="mb-3 flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, username, email, department" aria-label="Search users" className="flex-1" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter">
          <option value="">All</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
        </Select>
      </div>
      <ErrorText error={update.error} />
      {isLoading && <p className="text-sm text-muted">Loading…</p>}
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted">
          <tr>
            <th className="py-2 font-medium">Name</th>
            <th className="font-medium">Role</th>
            <th className="font-medium">Sign-in</th>
            <th className="font-medium">Last sign-in</th>
            <th className="font-medium">Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {users?.map((u) => (
            <UserRow key={u.id} user={u} expanded={open === u.id} onToggle={() => setOpen(open === u.id ? null : u.id)} onUpdate={(input) => update.mutate({ id: u.id, input })} />
          ))}
        </tbody>
      </table>
      {users && !users.length && <p className="py-4 text-sm text-muted">No one matches.</p>}
    </Panel>
  );
}

function UserRow({ user: u, expanded, onToggle, onUpdate }: { user: AdminUserRow; expanded: boolean; onToggle: () => void; onUpdate: (input: AdminUpdateUserInput) => void }) {
  return (
    <>
      <tr className="border-t border-border">
        <td className="py-2">
          <div className="flex items-center gap-2">
            <Avatar name={u.displayName} src={u.avatarUrl} size={28} />
            <div className="min-w-0">
              <div className="truncate font-medium">{u.displayName}</div>
              <div className="truncate text-xs text-muted">{u.username}{u.email ? ` · ${u.email}` : ''}</div>
            </div>
          </div>
        </td>
        <td>
          <Select value={u.role} onChange={(e) => onUpdate({ role: e.target.value as UserRole })} aria-label={`Role of ${u.displayName}`}>
            <option value="user">User</option>
            <option value="admin">Admin</option>
            <option value="guest">Guest</option>
          </Select>
        </td>
        <td className="text-xs text-muted">{u.authProvider}</td>
        <td className="text-xs text-muted">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Never'}</td>
        <td>{u.isActive ? <Badge tone="brand">Active</Badge> : <Badge tone="danger">Disabled</Badge>}</td>
        <td className="text-right whitespace-nowrap">
          <Btn onClick={() => onUpdate({ isActive: !u.isActive })}>{u.isActive ? 'Disable' : 'Enable'}</Btn>{' '}
          <Btn onClick={onToggle} aria-expanded={expanded}>More</Btn>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={6} className="bg-surface-2 p-3">
            <UserDetails user={u} />
          </td>
        </tr>
      )}
    </>
  );
}

function UserDetails({ user }: { user: AdminUserRow }) {
  const [password, setPassword] = useState('');
  const reset = useMutation({
    mutationFn: () => api(`/users/${user.id}/password`, { method: 'POST', json: { password } }),
    onSuccess: () => setPassword(''),
  });
  const { data: policies } = useQuery({
    queryKey: ['admin', 'user-policies', user.id],
    queryFn: () => api<{ sources: EffectivePolicySource[] }>(`/admin/users/${user.id}/policies`),
  });
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <h3 className="mb-2 text-xs font-semibold text-muted uppercase">Reset password</h3>
        {user.authProvider === 'local' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              reset.mutate();
            }}
            className="flex gap-2"
          >
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password (8+ characters)" aria-label="New password" minLength={8} required autoComplete="new-password" />
            <Btn type="submit" disabled={reset.isPending}>Reset</Btn>
          </form>
        ) : (
          <p className="text-sm text-muted">Signs in with the company directory; reset the password there.</p>
        )}
        {reset.isSuccess && <p className="mt-1 text-sm text-success">Password reset. Their sessions were signed out.</p>}
        <ErrorText error={reset.error} />
      </div>
      <div>
        <h3 className="mb-2 text-xs font-semibold text-muted uppercase">Effective policies</h3>
        <ul className="space-y-1 text-sm">
          {policies?.sources.map((s) => (
            <li key={s.type}>
              <span className="inline-block w-24 capitalize text-muted">{s.type}</span>
              {s.policyName ?? 'Built-in defaults'} {s.via !== 'builtin' && <Badge>{s.via === 'team' ? 'via team' : s.via === 'default' ? 'org default' : 'direct'}</Badge>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function CreateUser({ defaultRole, onDone }: { defaultRole: UserRole; onDone: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ username: '', displayName: '', email: '', password: '', role: defaultRole, jobTitle: '', department: '' });
  const create = useMutation({
    mutationFn: () =>
      api('/users', {
        method: 'POST',
        json: { ...form, email: form.email || undefined, jobTitle: form.jobTitle || undefined, department: form.department || undefined },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin'] });
      onDone();
    },
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  return (
    <form onSubmit={submit} className="mb-4 grid gap-2 rounded-md border border-border bg-surface-2 p-3 sm:grid-cols-2">
      <Input required placeholder="Username" aria-label="Username" value={form.username} onChange={set('username')} />
      <Input required placeholder="Display name" aria-label="Display name" value={form.displayName} onChange={set('displayName')} />
      <Input type="email" placeholder="Email (optional)" aria-label="Email" value={form.email} onChange={set('email')} />
      <Input required type="password" minLength={8} placeholder="Initial password" aria-label="Initial password" autoComplete="new-password" value={form.password} onChange={set('password')} />
      <Input placeholder="Job title" aria-label="Job title" value={form.jobTitle} onChange={set('jobTitle')} />
      <Input placeholder="Department" aria-label="Department" value={form.department} onChange={set('department')} />
      <Select value={form.role} onChange={set('role')} aria-label="Role">
        <option value="user">User</option>
        <option value="admin">Admin</option>
        <option value="guest">Guest</option>
      </Select>
      <div className="flex items-center gap-2">
        <Btn type="submit" variant="primary" disabled={create.isPending}>Create</Btn>
        <ErrorText error={create.error} />
      </div>
    </form>
  );
}
