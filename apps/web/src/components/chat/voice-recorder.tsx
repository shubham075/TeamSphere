'use client';

import { Mic, Send, Square, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

const MAX_SECONDS = 5 * 60;

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function pickMimeType() {
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

/**
 * Records a voice clip with the microphone. While recording it replaces the composer toolbar;
 * "Send" hands the finished file to the caller, which uploads it as an attachment.
 */
export function VoiceRecorder({ onDone, onCancel, onError }: { onDone: (file: File) => void; onCancel: () => void; onError: (msg: string) => void }) {
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const send = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        const mimeType = pickMimeType();
        const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        recorder.current = rec;
        rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
        rec.onstop = () => {
          stream?.getTracks().forEach((t) => t.stop());
          if (!send.current) return;
          const type = rec.mimeType.split(';')[0] || 'audio/webm';
          const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
          const stamp = new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
          onDone(new File(chunks.current, `Voice clip ${stamp}.${ext}`.replace(/[/:\\]/g, '.'), { type }));
        };
        rec.start(1000);
        const started = Date.now();
        timer = setInterval(() => {
          const s = (Date.now() - started) / 1000;
          setSeconds(s);
          if (s >= MAX_SECONDS) stop(true);
        }, 250);
      } catch {
        onError('Microphone not available. Check your browser permissions.');
        onCancel();
      }
    })();
    return () => {
      cancelled = true;
      clearInterval(timer);
      if (recorder.current?.state === 'recording') recorder.current.stop();
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stop(deliver: boolean) {
    send.current = deliver;
    if (recorder.current?.state === 'recording') recorder.current.stop();
    if (!deliver) onCancel();
  }

  return (
    <div className="flex flex-1 items-center gap-2 px-1" role="group" aria-label="Recording voice clip">
      <span className="flex items-center gap-1.5 text-sm text-danger">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-danger" aria-hidden />
        <Mic size={15} aria-hidden />
        <span aria-live="off">{mmss(seconds)}</span>
      </span>
      <span className="text-xs text-muted">max {mmss(MAX_SECONDS)}</span>
      <button onClick={() => stop(false)} aria-label="Discard recording" className="ml-auto rounded p-1.5 text-muted hover:bg-surface-hover hover:text-danger">
        <Trash2 size={16} />
      </button>
      <button onClick={() => stop(true)} disabled={seconds < 0.5} aria-label="Send voice clip" className="flex items-center gap-1 rounded-md bg-brand px-2.5 py-1 text-sm font-semibold text-brand-text hover:bg-brand-hover disabled:opacity-50">
        <Square size={12} className="fill-current" aria-hidden /> <Send size={14} aria-hidden />
      </button>
    </div>
  );
}
