import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AccessRequestInfo, ChatFileInfo, FileDetail, FileItemInfo, FileSharingInfo, FileVersionInfo, FolderListing,
} from '@teamsphere/shared';
import { create } from 'zustand';
import { api, ApiError, refreshSession } from './api';
import { useAuth } from './auth-store';

/** `channel:<id>` for a channel's document library; undefined for the signed-in user's My files. */
export type LibraryRef = string | undefined;

export const fk = {
  all: ['files'] as const,
  folder: (library: LibraryRef, id: string | null) => ['files', 'folder', library ?? 'me', id] as const,
  view: (view: string) => ['files', 'view', view] as const,
  search: (q: string) => ['files', 'search', q] as const,
  detail: (id: string) => ['files', 'detail', id] as const,
  versions: (id: string) => ['files', 'versions', id] as const,
  sharing: (id: string) => ['files', 'sharing', id] as const,
};

const libQuery = (library: LibraryRef, sep: '?' | '&' = '?') => (library ? `${sep}library=${encodeURIComponent(library)}` : '');

export function useFolder(library: LibraryRef, id: string | null) {
  return useQuery({
    queryKey: fk.folder(library, id),
    queryFn: () => api<FolderListing>(`/files/folder${id ? `?id=${id}${libQuery(library, '&')}` : libQuery(library)}`),
  });
}

export function useFileView<T = FileItemInfo[]>(view: 'shared' | 'recent' | 'recycle-bin' | 'chat-files' | 'access-requests') {
  return useQuery({ queryKey: fk.view(view), queryFn: () => api<T>(`/files/${view}`) });
}
export const useChatFiles = () => useFileView<ChatFileInfo[]>('chat-files');
export const useAccessRequests = () => useFileView<AccessRequestInfo[]>('access-requests');

export function useFileSearch(q: string) {
  return useQuery({ queryKey: fk.search(q), queryFn: () => api<FileItemInfo[]>(`/files/search?q=${encodeURIComponent(q)}`), enabled: !!q.trim() });
}

export function useVersions(id: string) {
  return useQuery({ queryKey: fk.versions(id), queryFn: () => api<FileVersionInfo[]>(`/files/items/${id}/versions`) });
}

export function useSharing(id: string) {
  return useQuery({ queryKey: fk.sharing(id), queryFn: () => api<FileSharingInfo>(`/files/items/${id}/sharing`) });
}

/** Opens an item (audited, adds it to Recent) and returns signed content URLs. */
export const fetchDetail = (id: string) => api<FileDetail>(`/files/items/${id}`);

/** Mutation that refreshes every Files view afterwards (lists are cheap; realtime does the same for others). */
export function useFilesMutation<TVars, TResult = unknown>(fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => qc.invalidateQueries({ queryKey: fk.all }) });
}

export const filesApi = {
  createFolder: (library: LibraryRef, parentId: string | null, name: string) =>
    api<FileItemInfo>(`/files/folders${libQuery(library)}`, { method: 'POST', json: { parentId, name } }),
  rename: (id: string, name: string) => api<FileItemInfo>(`/files/items/${id}`, { method: 'PATCH', json: { name } }),
  move: (id: string, library: LibraryRef, parentId: string | null) =>
    api<FileItemInfo>(`/files/items/${id}/move${libQuery(library)}`, { method: 'POST', json: { parentId } }),
  copy: (id: string, library: LibraryRef, parentId: string | null) =>
    api<FileItemInfo>(`/files/items/${id}/copy${libQuery(library)}`, { method: 'POST', json: { parentId } }),
  remove: (id: string) => api(`/files/items/${id}`, { method: 'DELETE' }),
  restore: (id: string) => api(`/files/items/${id}/restore`, { method: 'POST' }),
  purge: (id: string) => api(`/files/items/${id}/permanent`, { method: 'DELETE' }),
  emptyBin: () => api('/files/recycle-bin', { method: 'DELETE' }),
  restoreVersion: (id: string, versionId: string) => api(`/files/items/${id}/versions/${versionId}/restore`, { method: 'POST' }),
  share: (id: string, userIds: string[], role: 'view' | 'edit') =>
    api<FileSharingInfo>(`/files/items/${id}/shares`, { method: 'POST', json: { userIds, role } }),
  unshare: (id: string, userId: string) => api<FileSharingInfo>(`/files/items/${id}/shares/${userId}`, { method: 'DELETE' }),
  createLink: (id: string, role: 'view' | 'edit') => api(`/files/items/${id}/links`, { method: 'POST', json: { role } }),
  revokeLink: (linkId: string) => api(`/files/links/${linkId}`, { method: 'DELETE' }),
  redeem: (token: string) => api<{ id: string; kind: 'file' | 'folder' }>(`/files/links/${token}/redeem`, { method: 'POST' }),
  requestAccess: (id: string, role: 'view' | 'edit', message?: string) =>
    api(`/files/items/${id}/access-requests`, { method: 'POST', json: { role, message } }),
  decide: (requestId: string, decision: 'approve' | 'deny', role?: 'view' | 'edit') =>
    api(`/files/access-requests/${requestId}`, { method: 'POST', json: { decision, role } }),
};

// ------------------------------------------------------------------ uploads

export interface UploadJob {
  id: string;
  name: string;
  size: number;
  loaded: number;
  status: 'uploading' | 'done' | 'error';
  error?: string;
  versioned?: boolean;
}

interface UploadState {
  jobs: UploadJob[];
  patch: (id: string, p: Partial<UploadJob>) => void;
  add: (job: UploadJob) => void;
  clearFinished: () => void;
}

export const useUploads = create<UploadState>((set) => ({
  jobs: [],
  add: (job) => set((s) => ({ jobs: [...s.jobs, job] })),
  patch: (id, p) => set((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...p } : j)) })),
  clearFinished: () => set((s) => ({ jobs: s.jobs.filter((j) => j.status === 'uploading') })),
}));

/** XHR rather than fetch so the upload panel can show progress. Retries once after refreshing an expired token. */
function sendWithProgress(url: string, file: File, onProgress: (loaded: number) => void, retry = true): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api${url}`);
    xhr.withCredentials = true;
    const token = useAuth.getState().accessToken;
    if (token) xhr.setRequestHeader('authorization', `Bearer ${token}`);
    xhr.setRequestHeader('x-teamsphere', '1');
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onerror = () => reject(new ApiError(0, 'Network error'));
    xhr.onload = async () => {
      let body: { message?: string } | undefined;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = undefined;
      }
      if (xhr.status === 401 && retry && (await refreshSession().catch(() => null))) {
        sendWithProgress(url, file, onProgress, false).then(resolve, reject);
      } else if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new ApiError(xhr.status, body?.message ?? (xhr.status === 413 ? 'File is too large' : xhr.statusText), body));
    };
    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
}

/** Uploads files one after another into a folder (or a new version of `versionOf`). */
export async function uploadFiles(qc: QueryClient, files: File[], target: { library: LibraryRef; parentId: string | null; versionOf?: string }) {
  const { add, patch } = useUploads.getState();
  const jobs = files.map((f) => ({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, file: f }));
  for (const { id, file } of jobs) add({ id, name: file.name, size: file.size, loaded: 0, status: 'uploading' });
  for (const { id, file } of jobs) {
    const url = target.versionOf
      ? `/files/items/${target.versionOf}/versions`
      : `/files/upload?${target.parentId ? `parentId=${target.parentId}` : ''}${libQuery(target.library, '&')}`;
    try {
      const res = (await sendWithProgress(url, file, (loaded) => patch(id, { loaded }))) as { versioned?: boolean };
      patch(id, { status: 'done', loaded: file.size, versioned: !!target.versionOf || !!res?.versioned });
    } catch (e) {
      patch(id, { status: 'error', error: e instanceof Error ? e.message : 'Upload failed' });
    }
    void qc.invalidateQueries({ queryKey: fk.all });
  }
}

// ------------------------------------------------------------------ display helpers

export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | null;

export function previewKind(mime: string | null): PreviewKind {
  if (!mime) return null;
  if (/^image\/(png|jpe?g|gif|webp|bmp)$/.test(mime)) return 'image';
  if (/^video\/(mp4|webm|ogg)$/.test(mime)) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'text/plain') return 'text';
  return null;
}

export function itemPath(item: { id: string; kind: 'file' | 'folder' }) {
  return item.kind === 'folder' ? `/files?folder=${item.id}` : `/files/item/${item.id}`;
}

export function absoluteUrl(path: string) {
  return typeof location === 'undefined' ? path : `${location.origin}${path}`;
}
