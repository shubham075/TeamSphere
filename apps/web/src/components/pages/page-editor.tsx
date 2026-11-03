'use client';

import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import clsx from 'clsx';
import {
  Bold, Code, Heading1, Heading2, Heading3, Italic, Link2, List, ListChecks, ListOrdered, Loader2, Quote, Redo2, SquareCode,
  Strikethrough, Undo2,
} from 'lucide-react';
import { useEffect } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';
import { useAuth } from '@/lib/auth-store';
import { cursorColor, useCollabDoc } from '@/lib/collab';

/**
 * A co-edited rich page. `template` is inserted once when an editable page is opened empty (meeting notes use it
 * for the agenda); `dark` styles it for the meeting stage.
 */
export function PageEditor({ pageId, template, dark, onReadOnly }: { pageId: string; template?: string; dark?: boolean; onReadOnly?: (ro: boolean) => void }) {
  const collab = useCollabDoc(`page:${pageId}`);
  useEffect(() => {
    if (collab.status === 'ready') onReadOnly?.(collab.readOnly);
  }, [collab, onReadOnly]);
  if (collab.status === 'loading') return <div className="p-6"><Loader2 className="animate-spin text-muted" /></div>;
  if (collab.status === 'error') return <p role="alert" className="p-6 text-sm text-danger">{collab.error}</p>;
  return <Editing key={pageId} doc={collab.doc} awareness={collab.awareness} readOnly={collab.readOnly} template={template} dark={dark} />;
}

function Editing({ doc, awareness, readOnly, template, dark }: { doc: Y.Doc; awareness: Awareness; readOnly: boolean; template?: string; dark?: boolean }) {
  const me = useAuth((s) => s.user);
  const editor = useEditor({
    immediatelyRender: false,
    editable: !readOnly,
    extensions: [
      // Yjs keeps the history (per person), so the built-in undo/redo is off.
      StarterKit.configure({ undoRedo: false, link: { openOnClick: true, autolink: true, defaultProtocol: 'https' } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: readOnly ? '' : 'Start writing, or type a heading with # …' }),
      Collaboration.configure({ document: doc }),
      CollaborationCaret.configure({ provider: { awareness }, user: { name: me?.displayName ?? 'Someone', color: cursorColor(me?.id ?? '') } }),
    ],
    editorProps: { attributes: { class: 'tiptap-page focus:outline-none', 'aria-label': 'Page content', role: 'textbox', 'aria-multiline': 'true' } },
  });

  // Seed an empty page once (first editor to open it), after the server state has been applied.
  useEffect(() => {
    if (!editor || readOnly || !template) return;
    if (doc.getXmlFragment('default').length === 0) editor.commands.setContent(template);
  }, [editor, readOnly, template, doc]);

  if (!editor) return null;
  return (
    <div className={clsx('flex min-h-0 flex-1 flex-col', dark && 'tiptap-dark')}>
      {!readOnly && <Toolbar editor={editor} dark={dark} />}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <EditorContent editor={editor} className={clsx('mx-auto max-w-3xl px-6 py-4', dark ? 'text-white' : 'text-text')} />
      </div>
    </div>
  );
}

function Toolbar({ editor, dark }: { editor: Editor; dark?: boolean }) {
  // Re-render on selection changes so active states stay correct.
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'), italic: e.isActive('italic'), strike: e.isActive('strike'), code: e.isActive('code'),
      h1: e.isActive('heading', { level: 1 }), h2: e.isActive('heading', { level: 2 }), h3: e.isActive('heading', { level: 3 }),
      bullet: e.isActive('bulletList'), ordered: e.isActive('orderedList'), task: e.isActive('taskList'),
      quote: e.isActive('blockquote'), codeBlock: e.isActive('codeBlock'), link: e.isActive('link'),
    }),
  });
  const chain = () => editor.chain().focus();
  const btn = (label: string, active: boolean, onClick: () => void, Icon: typeof Bold) => (
    <button
      key={label}
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={clsx('rounded p-1.5', active ? 'bg-brand-soft text-brand' : dark ? 'text-white/70 hover:bg-white/10' : 'text-muted hover:bg-surface-hover')}
    >
      <Icon size={16} />
    </button>
  );
  const setLink = () => {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = prompt('Link address', prev ?? 'https://');
    if (url === null) return;
    if (!url.trim()) chain().extendMarkRange('link').unsetLink().run();
    else if (/^(https?:|mailto:)/i.test(url.trim())) chain().extendMarkRange('link').setLink({ href: url.trim() }).run();
  };
  return (
    <div role="toolbar" aria-label="Formatting" className={clsx('flex flex-wrap items-center gap-0.5 border-b px-3 py-1', dark ? 'border-white/10' : 'border-border bg-surface')}>
      {btn('Bold', s.bold, () => chain().toggleBold().run(), Bold)}
      {btn('Italic', s.italic, () => chain().toggleItalic().run(), Italic)}
      {btn('Strikethrough', s.strike, () => chain().toggleStrike().run(), Strikethrough)}
      {btn('Inline code', s.code, () => chain().toggleCode().run(), Code)}
      {btn('Link', s.link, setLink, Link2)}
      <span aria-hidden className="mx-1 h-5 w-px bg-border" />
      {btn('Heading 1', s.h1, () => chain().toggleHeading({ level: 1 }).run(), Heading1)}
      {btn('Heading 2', s.h2, () => chain().toggleHeading({ level: 2 }).run(), Heading2)}
      {btn('Heading 3', s.h3, () => chain().toggleHeading({ level: 3 }).run(), Heading3)}
      <span aria-hidden className="mx-1 h-5 w-px bg-border" />
      {btn('Bulleted list', s.bullet, () => chain().toggleBulletList().run(), List)}
      {btn('Numbered list', s.ordered, () => chain().toggleOrderedList().run(), ListOrdered)}
      {btn('Checklist', s.task, () => chain().toggleTaskList().run(), ListChecks)}
      {btn('Quote', s.quote, () => chain().toggleBlockquote().run(), Quote)}
      {btn('Code block', s.codeBlock, () => chain().toggleCodeBlock().run(), SquareCode)}
      <span aria-hidden className="mx-1 h-5 w-px bg-border" />
      {btn('Undo', false, () => chain().undo().run(), Undo2)}
      {btn('Redo', false, () => chain().redo().run(), Redo2)}
    </div>
  );
}
