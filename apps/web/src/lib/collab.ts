'use client';

import { useEffect, useState } from 'react';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { COLLAB_WS_EVENTS, type CollabJoinResult } from '@teamsphere/shared';
import { getSocket } from './socket';

const REMOTE = 'remote';

export type CollabState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; doc: Y.Doc; awareness: Awareness; readOnly: boolean };

/**
 * Syncs a Yjs document (`page:<id>` / `board:<id>`) through the API over the app's Socket.IO connection, the same
 * way the meeting whiteboard does: join → full state, then incremental updates both ways, plus cursor awareness.
 * After a reconnect it joins again and resends its state so edits made offline aren't lost.
 */
export function useCollabDoc(key: string | null): CollabState {
  const [state, setState] = useState<CollabState>({ status: 'loading' });

  useEffect(() => {
    if (!key) return;
    setState({ status: 'loading' });
    const socket = getSocket();
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    let synced = false;
    let closed = false;

    const join = () =>
      socket.emit(COLLAB_WS_EVENTS.join, { doc: key }, (r: CollabJoinResult) => {
        if (closed) return;
        if (!r.ok || !r.state) return setState({ status: 'error', error: r.error ?? 'This item is not available' });
        Y.applyUpdate(doc, new Uint8Array(r.state as ArrayBuffer), REMOTE);
        if (!synced) {
          synced = true;
          setState({ status: 'ready', doc, awareness, readOnly: !!r.readOnly });
        }
        socket.emit(COLLAB_WS_EVENTS.awareness, { doc: key, update: encodeAwarenessUpdate(awareness, [doc.clientID]) });
      });

    const onDocUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin !== REMOTE) socket.emit(COLLAB_WS_EVENTS.update, { doc: key, update });
    };
    const onAwareness = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      if (origin === REMOTE) return;
      const changed = [...added, ...updated, ...removed];
      socket.emit(COLLAB_WS_EVENTS.awareness, { doc: key, update: encodeAwarenessUpdate(awareness, changed) });
    };
    const onRemoteUpdate = (e: { doc: string; update: ArrayBuffer }) => {
      if (e.doc === key) Y.applyUpdate(doc, new Uint8Array(e.update), REMOTE);
    };
    const onRemoteAwareness = (e: { doc: string; update: ArrayBuffer }) => {
      if (e.doc === key) applyAwarenessUpdate(awareness, new Uint8Array(e.update), REMOTE);
    };
    const onConnect = () => {
      join();
      if (synced) socket.emit(COLLAB_WS_EVENTS.update, { doc: key, update: Y.encodeStateAsUpdate(doc) });
    };

    doc.on('update', onDocUpdate);
    awareness.on('update', onAwareness);
    socket.on(COLLAB_WS_EVENTS.update, onRemoteUpdate);
    socket.on(COLLAB_WS_EVENTS.awareness, onRemoteAwareness);
    socket.on('connect', onConnect);
    join();

    return () => {
      closed = true;
      // Tell the others our cursor is gone before leaving.
      removeAwarenessStates(awareness, [doc.clientID], 'leave');
      socket.emit(COLLAB_WS_EVENTS.leave, { doc: key });
      socket.off(COLLAB_WS_EVENTS.update, onRemoteUpdate);
      socket.off(COLLAB_WS_EVENTS.awareness, onRemoteAwareness);
      socket.off('connect', onConnect);
      awareness.destroy();
      doc.destroy();
    };
  }, [key]);

  return state;
}

const CURSOR_COLORS = ['#5b5bd6', '#0f7b8a', '#b4467d', '#8a5a00', '#3b7d23', '#a4373a', '#6b4fbb', '#2b6cb0'];

/** Stable cursor color per person. */
export function cursorColor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return CURSOR_COLORS[h % CURSOR_COLORS.length];
}
