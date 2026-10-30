'use client';

import { useEffect, useState } from 'react';
import { createTLStore, defaultBindingUtils, defaultShapeUtils, Tldraw, type TLRecord, type TLStoreWithStatus } from 'tldraw';
import 'tldraw/tldraw.css';
import * as Y from 'yjs';
import { WS_EVENTS } from '@teamsphere/shared';
import { getSocket } from '@/lib/socket';

const REMOTE = 'remote';

/**
 * Meeting whiteboard: tldraw records mirrored into a Yjs map, synced through the API over the existing Socket.IO
 * connection (`whiteboard:*` events). The API keeps and saves the document, so it survives the meeting.
 */
export default function Whiteboard({ meetingId }: { meetingId: string }) {
  const [store, setStore] = useState<TLStoreWithStatus>({ status: 'loading' });

  useEffect(() => {
    const socket = getSocket();
    const doc = new Y.Doc();
    const records = doc.getMap<TLRecord>('tl_records');
    const tl = createTLStore({ shapeUtils: defaultShapeUtils, bindingUtils: defaultBindingUtils });
    const unsubs: (() => void)[] = [];
    let synced = false;
    let closed = false;

    const join = () => socket.emit(WS_EVENTS.whiteboardJoin, { meetingId }, (r: { ok: boolean; state?: ArrayBuffer; error?: string }) => {
      if (closed) return;
      if (!r.ok || !r.state) return setStore({ status: 'error', error: new Error(r.error ?? 'Whiteboard unavailable') });
      Y.applyUpdate(doc, new Uint8Array(r.state), REMOTE);
      if (!synced) start();
    });

    function start() {
      synced = true;
      if (records.size === 0) {
        // First person to open the board seeds it with tldraw's default document and page.
        doc.transact(() => tl.allRecords().forEach((rec) => records.set(rec.id, rec)));
      } else {
        tl.mergeRemoteChanges(() => {
          tl.clear();
          tl.put([...records.values()]);
        });
      }
      // Local edits → Yjs.
      unsubs.push(tl.listen(({ changes }) => {
        doc.transact(() => {
          Object.values(changes.added).forEach((rec) => records.set(rec.id, rec));
          Object.values(changes.updated).forEach(([, rec]) => records.set(rec.id, rec));
          Object.values(changes.removed).forEach((rec) => records.delete(rec.id));
        });
      }, { source: 'user', scope: 'document' }));
      // Remote Yjs changes → tldraw.
      const observe = (event: Y.YMapEvent<TLRecord>, tx: Y.Transaction) => {
        if (tx.local) return;
        const put: TLRecord[] = [];
        const remove: TLRecord['id'][] = [];
        event.changes.keys.forEach((change, id) => {
          if (change.action === 'delete') remove.push(id as TLRecord['id']);
          else put.push(records.get(id)!);
        });
        tl.mergeRemoteChanges(() => {
          if (remove.length) tl.remove(remove);
          if (put.length) tl.put(put);
        });
      };
      records.observe(observe);
      unsubs.push(() => records.unobserve(observe));
      setStore({ status: 'synced-remote', connectionStatus: 'online', store: tl });
    }

    // Yjs updates made here go to the server, which relays them to everyone else on the board.
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== REMOTE) socket.emit(WS_EVENTS.whiteboardUpdate, { meetingId, update });
    });
    const onUpdate = (e: { meetingId: string; update: ArrayBuffer }) => {
      if (e.meetingId === meetingId) Y.applyUpdate(doc, new Uint8Array(e.update), REMOTE);
    };
    socket.on(WS_EVENTS.whiteboardUpdate, onUpdate);
    // After a reconnect, join again: the server's state merges in and our missed edits are resent below.
    const onConnect = () => {
      join();
      if (synced) socket.emit(WS_EVENTS.whiteboardUpdate, { meetingId, update: Y.encodeStateAsUpdate(doc) });
    };
    socket.on('connect', onConnect);
    join();

    return () => {
      closed = true;
      socket.emit(WS_EVENTS.whiteboardLeave, { meetingId });
      socket.off(WS_EVENTS.whiteboardUpdate, onUpdate);
      socket.off('connect', onConnect);
      unsubs.forEach((u) => u());
      doc.destroy();
    };
  }, [meetingId]);

  if (store.status === 'error') return <p role="alert" className="p-4 text-sm">{store.error.message}</p>;
  return (
    <div className="h-full w-full overflow-hidden rounded-lg bg-white text-black">
      <Tldraw store={store} />
    </div>
  );
}
