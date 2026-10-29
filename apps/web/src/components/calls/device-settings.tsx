'use client';

import { Volume2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useCallStore } from '@/lib/call-store';
import { audioConstraints, DevicePrefs, getDevicePrefs, setDevicePref } from '@/lib/devices';

const LABELS: Record<keyof DevicePrefs, string> = { audioinput: 'Microphone', videoinput: 'Camera', audiooutput: 'Speaker' };

/**
 * Device settings and test call: pick mic / camera / speaker, see the camera, watch the mic level and play a
 * test tone. Works before a call (Calls app) and during one (switches the live devices).
 */
export function DeviceSettings({ onClose }: { onClose: () => void }) {
  const room = useCallStore((s) => s.room);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [prefs, setPrefs] = useState<DevicePrefs>(getDevicePrefs);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Preview stream for the chosen camera + mic (separate from the call's own tracks).
  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let ctx: AudioContext | null = null;
    let cancelled = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints(prefs.audioinput),
          video: room?.localParticipant.isCameraEnabled ? false : { deviceId: prefs.videoinput ? { exact: prefs.videoinput } : undefined },
        });
      } catch {
        // Fall back to audio only (no camera, or camera busy).
        stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(prefs.audioinput) }).catch(() => null);
        if (!stream) return setError('Allow camera and microphone access in your browser to test your devices.');
      }
      if (cancelled) return stream.getTracks().forEach((t) => t.stop());
      setDevices(await navigator.mediaDevices.enumerateDevices());
      if (videoRef.current) videoRef.current.srcObject = stream;
      ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
        setLevel(Math.min(1, peak / 64));
        raf = requestAnimationFrame(tick);
      };
      tick();
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
    };
  }, [prefs.audioinput, prefs.videoinput, room]);

  function choose(kind: keyof DevicePrefs, id: string) {
    setDevicePref(kind, id);
    setPrefs(getDevicePrefs());
    if (room) void room.switchActiveDevice(kind, id || 'default').catch(() => setError(`Couldn't switch ${LABELS[kind].toLowerCase()}`));
  }

  function testSpeaker() {
    const audio = new Audio();
    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    const osc = ctx.createOscillator();
    osc.frequency.value = 523;
    osc.connect(dest);
    osc.start();
    osc.stop(ctx.currentTime + 0.8);
    audio.srcObject = dest.stream;
    const sink = audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    void (prefs.audiooutput && sink.setSinkId ? sink.setSinkId(prefs.audiooutput) : Promise.resolve()).then(() => audio.play());
    setTimeout(() => void ctx.close(), 1500);
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/40 p-4 pt-[8vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Device settings"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        className="w-full max-w-lg rounded-xl border border-border bg-surface text-text shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-lg font-semibold">Device settings</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-surface-hover">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <video ref={videoRef} autoPlay muted playsInline className="aspect-video w-full rounded-lg bg-black object-cover -scale-x-100" />
          {(['audioinput', 'audiooutput', 'videoinput'] as const).map((kind) => {
            const list = devices.filter((d) => d.kind === kind);
            return (
              <label key={kind} className="block text-sm">
                <span className="mb-1 block font-medium">{LABELS[kind]}</span>
                <span className="flex items-center gap-2">
                  <select
                    value={prefs[kind] ?? ''}
                    onChange={(e) => choose(kind, e.target.value)}
                    className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5"
                  >
                    <option value="">System default</option>
                    {list.map((d, i) => (
                      <option key={d.deviceId || i} value={d.deviceId}>
                        {d.label || `${LABELS[kind]} ${i + 1}`}
                      </option>
                    ))}
                  </select>
                  {kind === 'audiooutput' && (
                    <button type="button" onClick={testSpeaker} className="flex items-center gap-1 rounded-md border border-border px-2 py-1.5 hover:bg-surface-hover">
                      <Volume2 size={14} /> Test
                    </button>
                  )}
                </span>
                {kind === 'audioinput' && (
                  <span className="mt-2 block h-1.5 overflow-hidden rounded bg-surface-2" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
                    <span className="block h-full bg-success transition-[width] duration-75" style={{ width: `${level * 100}%` }} />
                  </span>
                )}
              </label>
            );
          })}
          <p className="text-xs text-muted">Noise suppression and echo cancellation are always on.</p>
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
      </div>
    </div>
  );
}
