/**
 * Ringtone (incoming) and ringback (outgoing) tones synthesized with Web Audio, so no audio assets are needed.
 * Browsers may block audio until the user has interacted with the page; then the tone is silently skipped.
 */
let ctx: AudioContext | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let playing: 'incoming' | 'outgoing' | null = null;

function beep(freqs: number[], start: number, length: number, volume: number) {
  if (!ctx) return;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.02);
  gain.gain.setValueAtTime(volume, start + length - 0.05);
  gain.gain.linearRampToValueAtTime(0, start + length);
  gain.connect(ctx.destination);
  for (const f of freqs) {
    const osc = ctx.createOscillator();
    osc.frequency.value = f;
    osc.connect(gain);
    osc.start(start);
    osc.stop(start + length);
  }
}

function pattern(kind: 'incoming' | 'outgoing') {
  if (!ctx) return;
  const t = ctx.currentTime + 0.05;
  if (kind === 'incoming') {
    beep([659], t, 0.18, 0.12);
    beep([784], t + 0.22, 0.18, 0.12);
    beep([988], t + 0.44, 0.3, 0.12);
  } else {
    beep([440, 480], t, 1.6, 0.05);
  }
}

export function startTone(kind: 'incoming' | 'outgoing') {
  if (playing === kind) return;
  stopTone();
  try {
    ctx ??= new AudioContext();
    void ctx.resume().catch(() => undefined);
  } catch {
    return;
  }
  playing = kind;
  pattern(kind);
  timer = setInterval(() => pattern(kind), kind === 'incoming' ? 2000 : 4000);
}

export function stopTone() {
  if (timer) clearInterval(timer);
  timer = null;
  playing = null;
}
