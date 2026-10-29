'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Circle, Phone, Send, Square, Voicemail, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { CallEndedEvent, MAX_VOICEMAIL_SECONDS } from '@teamsphere/shared';
import { Avatar } from '@/components/avatar';
import { api, ApiError } from '@/lib/api';
import { useCallStore } from '@/lib/call-store';
import { callQk, callTitle, endReasonLabel, formatCallDuration } from '@/lib/calls';
import { audioConstraints, getDevicePrefs } from '@/lib/devices';

type Stage = 'prompt' | 'recording' | 'review' | 'sending' | 'sent';

/** After an unanswered outgoing call: why it ended, call again, or leave a voicemail. */
export function CallEnded({ ended, meId }: { ended: CallEndedEvent; meId: string }) {
  const { call, voicemailFor } = ended;
  const qc = useQueryClient();
  const [stage, setStage] = useState<Stage>('prompt');
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const dismiss = () => useCallStore.getState().dismissEnded();

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      recorder.current?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  async function record() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(getDevicePrefs().audioinput) });
      const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t));
      const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setBlob(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
        setStage('review');
      };
      recorder.current = rec;
      rec.start(250);
      setSeconds(0);
      setStage('recording');
      timer.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_VOICEMAIL_SECONDS) stop();
          return s + 1;
        });
      }, 1000);
    } catch {
      setError('Allow microphone access to record a voicemail.');
    }
  }

  function stop() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }

  async function send() {
    if (!blob) return;
    setStage('sending');
    const form = new FormData();
    form.append('durationSec', String(seconds));
    form.append('file', blob, 'voicemail.webm');
    try {
      await api(`/calls/${call.id}/voicemail`, { method: 'POST', body: form });
      setStage('sent');
      void qc.invalidateQueries({ queryKey: callQk.history });
      setTimeout(dismiss, 1500);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not send the voicemail');
      setStage('review');
    }
  }

  const other = voicemailFor ?? call.participants.find((p) => !p.isCaller)?.user ?? null;

  return (
    <div role="dialog" aria-label="Call ended" className="w-80 rounded-xl border border-border bg-surface p-4 text-text shadow-2xl">
      <div className="flex items-start gap-3">
        <Avatar name={other?.displayName ?? callTitle(call, meId)} src={other?.avatarUrl} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{voicemailFor?.displayName ?? callTitle(call, meId)}</p>
          <p className="text-sm text-muted">{endReasonLabel(call.endReason)}</p>
        </div>
        <button onClick={dismiss} aria-label="Close" className="rounded p-1 hover:bg-surface-hover">
          <X size={16} />
        </button>
      </div>

      {stage === 'prompt' && (
        <div className="mt-4 flex gap-2">
          {voicemailFor && (
            <button onClick={record} className="flex flex-1 items-center justify-center gap-2 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-brand-text hover:bg-brand-hover">
              <Voicemail size={16} /> Leave a voicemail
            </button>
          )}
          <button
            onClick={() => {
              dismiss();
              void useCallStore.getState().start({ conversationId: call.conversationId ?? undefined, kind: call.kind });
            }}
            disabled={!call.conversationId}
            className="flex flex-1 items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-surface-hover"
          >
            <Phone size={16} /> Call again
          </button>
        </div>
      )}

      {stage === 'recording' && (
        <div className="mt-4 flex items-center gap-3" aria-live="polite">
          <Circle size={12} className="animate-pulse fill-danger text-danger" aria-hidden="true" />
          <span className="flex-1 text-sm tabular-nums">
            Recording {formatCallDuration(seconds)} / {formatCallDuration(MAX_VOICEMAIL_SECONDS)}
          </span>
          <button onClick={stop} className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-hover">
            <Square size={14} /> Stop
          </button>
        </div>
      )}

      {(stage === 'review' || stage === 'sending') && blob && (
        <div className="mt-4 space-y-3">
          <audio controls src={URL.createObjectURL(blob)} className="w-full" aria-label="Your voicemail" />
          <div className="flex gap-2">
            <button onClick={record} disabled={stage === 'sending'} className="flex-1 rounded-md border border-border px-3 py-2 text-sm hover:bg-surface-hover">
              Re-record
            </button>
            <button
              onClick={send}
              disabled={stage === 'sending'}
              className="flex flex-1 items-center justify-center gap-2 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-brand-text hover:bg-brand-hover disabled:opacity-50"
            >
              <Send size={14} /> {stage === 'sending' ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      )}

      {stage === 'sent' && <p className="mt-4 text-sm text-success">Voicemail sent.</p>}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </div>
  );
}
