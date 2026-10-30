'use client';

import clsx from 'clsx';
import { Mic, MicOff, Video, VideoOff, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { audioConstraints, DevicePrefs, getDevicePrefs, setDevicePref } from '@/lib/devices';

export interface JoinChoices {
  mic: boolean;
  camera: boolean;
  /** "Don't use audio": join without mic and with incoming audio muted (e.g. already in the room on another device). */
  audioOff: boolean;
}

const LABELS: Record<keyof DevicePrefs, string> = { audioinput: 'Microphone', videoinput: 'Camera', audiooutput: 'Speaker' };

/** Pre-join screen: camera preview, mic level, device selection and audio options. */
export function PreJoin({ title, subtitle, busy, onJoin }: { title: string; subtitle?: string; busy: boolean; onJoin: (c: JoinChoices) => void }) {
  const [choices, setChoices] = useState<JoinChoices>({ mic: true, camera: true, audioOff: false });
  const [prefs, setPrefs] = useState<DevicePrefs>(getDevicePrefs);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let raf = 0;
    let cancelled = false;
    const wantVideo = choices.camera;
    const wantAudio = choices.mic && !choices.audioOff;
    (async () => {
      if (!wantVideo && !wantAudio) return;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: wantAudio ? audioConstraints(prefs.audioinput) : false,
          video: wantVideo ? { deviceId: prefs.videoinput ? { exact: prefs.videoinput } : undefined } : false,
        });
        setError(null);
      } catch {
        setError('Camera or microphone is blocked or unavailable. You can still join; allow access in your browser to use them.');
        return;
      }
      if (cancelled) return stream.getTracks().forEach((t) => t.stop());
      setDevices(await navigator.mediaDevices.enumerateDevices());
      if (videoRef.current) videoRef.current.srcObject = wantVideo ? stream : null;
      if (wantAudio && stream.getAudioTracks().length) {
        ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        ctx.createMediaStreamSource(stream).connect(analyser);
        const buf = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteFrequencyData(buf);
          setLevel(Math.min(1, buf.reduce((s, v) => s + v, 0) / buf.length / 60));
          raf = requestAnimationFrame(tick);
        };
        tick();
      }
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      void ctx?.close();
      stream?.getTracks().forEach((t) => t.stop());
      setLevel(0);
    };
  }, [choices.camera, choices.mic, choices.audioOff, prefs.audioinput, prefs.videoinput]);

  const pick = (kind: keyof DevicePrefs, id: string) => {
    setDevicePref(kind, id);
    setPrefs(getDevicePrefs());
  };
  const toggle = (k: keyof JoinChoices) => setChoices((c) => ({ ...c, [k]: !c[k] }));

  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto p-6">
      <div className="w-full max-w-2xl">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {subtitle && <p className="mb-4 text-sm text-muted">{subtitle}</p>}
        <div className="mt-3 overflow-hidden rounded-xl border border-border bg-[#14141c]">
          <div className="relative aspect-video">
            {choices.camera ? (
              <video ref={videoRef} autoPlay playsInline muted className="h-full w-full -scale-x-100 object-cover" aria-label="Camera preview" />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-white/70">Your camera is off</div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 p-3 text-white">
            <Toggle on={choices.camera} label={choices.camera ? 'Turn camera off' : 'Turn camera on'} onClick={() => toggle('camera')}>
              {choices.camera ? <Video size={18} /> : <VideoOff size={18} />}
            </Toggle>
            <Toggle on={choices.mic && !choices.audioOff} disabled={choices.audioOff} label={choices.mic ? 'Mute microphone' : 'Unmute microphone'} onClick={() => toggle('mic')}>
              {choices.mic && !choices.audioOff ? <Mic size={18} /> : <MicOff size={18} />}
            </Toggle>
            <span className="h-2 w-24 overflow-hidden rounded-full bg-white/15" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
              <span className="block h-full bg-success transition-[width]" style={{ width: `${level * 100}%` }} />
            </span>
            <label className="ml-auto flex items-center gap-2 text-sm">
              <input type="checkbox" checked={choices.audioOff} onChange={() => toggle('audioOff')} />
              {choices.audioOff ? <VolumeX size={16} /> : <Volume2 size={16} />} Don’t use audio
            </label>
          </div>
        </div>
        {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {(Object.keys(LABELS) as (keyof DevicePrefs)[]).map((kind) => (
            <label key={kind} className="text-sm">
              <span className="mb-1 block font-medium">{LABELS[kind]}</span>
              <select value={prefs[kind] ?? ''} onChange={(e) => pick(kind, e.target.value)} className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm">
                <option value="">System default</option>
                {devices.filter((d) => d.kind === kind && d.deviceId && d.deviceId !== 'default').map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || LABELS[kind]}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <button onClick={() => onJoin(choices)} disabled={busy} className="mt-5 rounded-md bg-brand px-6 py-2.5 font-semibold text-brand-text hover:bg-brand-hover disabled:opacity-50">
          {busy ? 'Joining…' : 'Join now'}
        </button>
      </div>
    </div>
  );
}

function Toggle({ on, label, onClick, disabled, children }: { on: boolean; label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label} title={label} aria-pressed={!on} className={clsx('flex h-10 w-10 items-center justify-center rounded-full disabled:opacity-40', on ? 'bg-white/15 hover:bg-white/25' : 'bg-danger')}>
      {children}
    </button>
  );
}
