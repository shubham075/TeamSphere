'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { OrgInfo, UpdateOrgSettingsInput } from '@teamsphere/shared';
import { api } from '@/lib/api';
import { useOrg } from '@/lib/search';
import { Btn, ErrorText, Input, Panel, Toggle } from './ui';

export function AdminOrg() {
  const qc = useQueryClient();
  const { data: org } = useOrg();
  const [name, setName] = useState('');
  const [maxMb, setMaxMb] = useState(100);
  useEffect(() => {
    if (org) {
      setName(org.orgName);
      setMaxMb(org.maxFileSizeMb);
    }
  }, [org]);
  const save = useMutation({
    mutationFn: (input: UpdateOrgSettingsInput) => api<OrgInfo>('/admin/org', { method: 'PUT', json: input }),
    onSuccess: (info) => qc.setQueryData(['org'], info),
  });
  const logo = useMutation({
    mutationFn: async (file: File | null) => {
      if (!file) return api<OrgInfo>('/admin/org/logo', { method: 'DELETE' });
      const body = new FormData();
      body.append('file', file);
      return api<OrgInfo>('/admin/org/logo', { method: 'PUT', body });
    },
    onSuccess: (info) => qc.setQueryData(['org'], info),
  });
  if (!org) return null;

  return (
    <div className="space-y-6">
      <Panel title="Branding">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({ orgName: name });
          }}
          className="mb-4 flex items-end gap-2"
        >
          <label className="flex-1 text-sm">
            <span className="mb-1 block text-muted">Organization / product name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} required className="w-full" />
          </label>
          <Btn type="submit" variant="primary">Save</Btn>
        </form>
        <div className="flex items-center gap-4 text-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {org.logoUrl ? <img src={org.logoUrl} alt="Current logo" className="h-12 w-12 rounded border border-border object-contain" /> : <span className="text-muted">No logo (the TeamSphere mark is shown).</span>}
          <label className="cursor-pointer rounded-md border border-border px-3 py-1.5 hover:bg-surface-hover">
            Upload logo
            <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && logo.mutate(e.target.files[0])} />
          </label>
          {org.logoUrl && <Btn onClick={() => logo.mutate(null)}>Remove</Btn>}
        </div>
        <ErrorText error={logo.error} />
      </Panel>

      <Panel title="Access & content">
        <Toggle label="Guest access" hint="Allow guest accounts in teams and anonymous guests in meetings." checked={org.guestAccess} onChange={(v) => save.mutate({ guestAccess: v })} />
        <Toggle label="Link previews" hint="Show previews for links in messages (policies can also turn them off per person)." checked={org.linkPreviews} onChange={(v) => save.mutate({ linkPreviews: v })} />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({ maxFileSizeMb: maxMb });
          }}
          className="mt-2 flex items-end gap-2 text-sm"
        >
          <label>
            <span className="mb-1 block text-muted">Maximum upload size (MB, up to 250)</span>
            <Input type="number" min={1} max={250} value={maxMb} onChange={(e) => setMaxMb(Number(e.target.value))} />
          </label>
          <Btn type="submit">Save</Btn>
        </form>
        <ErrorText error={save.error} />
        {save.isSuccess && <p className="mt-2 text-sm text-success">Saved.</p>}
      </Panel>
    </div>
  );
}
