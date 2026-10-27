import { Fragment, ReactNode } from 'react';

/**
 * Renders the markdown-lite message format as React elements (never as HTML, so message text can't inject markup):
 * ```code blocks```, `inline code`, **bold**, *italic* / _italic_, ~~strike~~, links, and @[Name](userId) mentions.
 */
export function RichText({ body, meId }: { body: string; meId?: string }) {
  const parts = body.split(/(```[\s\S]*?```)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('```') && part.endsWith('```') && part.length >= 6 ? (
          <pre key={i} className="my-1 overflow-x-auto rounded-md bg-surface-2 p-3 font-mono text-[13px] leading-5">
            {part.slice(3, -3).replace(/^\w*\n/, '')}
          </pre>
        ) : (
          <Fragment key={i}>{renderInline(part, meId, `${i}`)}</Fragment>
        ),
      )}
    </>
  );
}

const INLINE = new RegExp(
  [
    /@\[([^\]\n]{1,128})\]\(([a-z0-9]{8,40})\)/.source, // 1,2 mention
    /`([^`\n]+)`/.source, // 3 code
    /\*\*([^*\n]+)\*\*/.source, // 4 bold
    /~~([^~\n]+)~~/.source, // 5 strike
    /(?<![\w*])\*([^*\n]+)\*(?!\w)/.source, // 6 italic *x*
    /(?<![\w_])_([^_\n]+)_(?!\w)/.source, // 7 italic _x_
    /(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/.source, // 8 url
  ].join('|'),
  'g',
);

function renderInline(text: string, meId: string | undefined, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    const index = m.index ?? 0;
    if (index > last) out.push(text.slice(last, index));
    const key = `${keyPrefix}-${n++}`;
    if (m[1] !== undefined) {
      out.push(
        <span
          key={key}
          className={
            m[2] === meId
              ? 'rounded bg-brand px-1 font-semibold text-brand-text'
              : 'rounded bg-brand-soft px-1 font-semibold text-brand'
          }
        >
          @{m[1]}
        </span>,
      );
    } else if (m[3] !== undefined) {
      out.push(
        <code key={key} className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[13px]">
          {m[3]}
        </code>,
      );
    } else if (m[4] !== undefined) {
      out.push(<strong key={key}>{renderInline(m[4], meId, key)}</strong>);
    } else if (m[5] !== undefined) {
      out.push(<s key={key}>{renderInline(m[5], meId, key)}</s>);
    } else if (m[6] !== undefined || m[7] !== undefined) {
      out.push(<em key={key}>{renderInline((m[6] ?? m[7])!, meId, key)}</em>);
    } else if (m[8] !== undefined) {
      out.push(
        <a key={key} href={m[8]} target="_blank" rel="noopener noreferrer" className="break-all text-brand underline-offset-2 hover:underline">
          {m[8]}
        </a>,
      );
    }
    last = index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
