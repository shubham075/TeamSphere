'use client';

import { useEffect, useState } from 'react';
import { createTLStore, defaultBindingUtils, defaultShapeUtils, Tldraw, type TLRecord, type TLStoreWithStatus } from 'tldraw';
import 'tldraw/tldraw.css';
import type * as Y from 'yjs';
import { useCollabDoc } from '@/lib/collab';

/**
 * A standalone whiteboard: tldraw records mirrored into a Yjs map (`tl_records`), synced by `useCollabDoc` the same
 * way the meeting whiteboard syncs. Viewers get a read-only canvas.
 */
export default function BoardCanvas({ boardId }: { boardId: string }) {
  const collab = useCollabDoc(`board:${boardId}`);
  if (collab.status === 'loading') return <p className="p-4 text-sm text-muted">Loading whiteboard…</p>;
  if (collab.status === 'error') return <p role="alert" className="p-4 text-sm text-danger">{collab.error}</p>;
  return <Canvas key={boardId} doc={collab.doc} readOnly={collab.readOnly} />;
}

function Canvas({ doc, readOnly }: { doc: Y.Doc; readOnly: boolean }) {
  const [store, setStore] = useState<TLStoreWithStatus>({ status: 'loading' });

  useEffect(() => {
    const records = doc.getMap<TLRecord>('tl_records');
    const tl = createTLStore({ shapeUtils: defaultShapeUtils, bindingUtils: defaultBindingUtils });
    if (records.size === 0 && !readOnly) {
      // First person to open the board seeds it with tldraw's default document and page.
      doc.transact(() => tl.allRecords().forEach((rec) => records.set(rec.id, rec)));
    } else {
      tl.mergeRemoteChanges(() => {
        tl.clear();
        tl.put([...records.values()]);
      });
    }
    // Local edits → Yjs.
    const unlisten = tl.listen(({ changes }) => {
      doc.transact(() => {
        Object.values(changes.added).forEach((rec) => records.set(rec.id, rec));
        Object.values(changes.updated).forEach(([, rec]) => records.set(rec.id, rec));
        Object.values(changes.removed).forEach((rec) => records.delete(rec.id));
      });
    }, { source: 'user', scope: 'document' });
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
    setStore({ status: 'synced-remote', connectionStatus: 'online', store: tl });
    return () => {
      unlisten();
      records.unobserve(observe);
    };
  }, [doc, readOnly]);

  return (
    <div className="h-full w-full overflow-hidden bg-white text-black">
      <Tldraw
        store={store}
        licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY}
        onMount={(editor) => {
          if (readOnly) editor.updateInstanceState({ isReadonly: true });
        }}
      />
    </div>
  );
}
