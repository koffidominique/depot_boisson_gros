export type PosFeedbackKind = 'scan_success' | 'error' | 'sale_success';

const STORAGE_KEY = 'gestdepot_pos_feedback_enabled';

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) {
    audioCtx = new Ctx();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export function isPosFeedbackEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  const val = localStorage.getItem(STORAGE_KEY);
  return val === null ? true : val === 'true';
}

export function setPosFeedbackEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, String(enabled));
}

function playToneSequence(
  notes: { freq: number; durationMs: number; delayMs: number; gain: number; type: OscillatorType }[]
): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;

  for (const n of notes) {
    const start = now + n.delayMs / 1000;
    const end = start + n.durationMs / 1000;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = n.type;
    osc.frequency.setValueAtTime(n.freq, start);

    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(n.gain, start + 0.008);
    amp.gain.exponentialRampToValueAtTime(0.0001, end);

    osc.connect(amp);
    amp.connect(ctx.destination);
    osc.start(start);
    osc.stop(end + 0.01);
  }
}

export function triggerPosFeedback(kind: PosFeedbackKind): void {
  if (!isPosFeedbackEnabled()) return;

  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      if (kind === 'scan_success') {
        navigator.vibrate(30);
      } else if (kind === 'error') {
        navigator.vibrate([55, 35, 75]);
      } else if (kind === 'sale_success') {
        navigator.vibrate([35, 25, 55]);
      }
    }
  } catch {
    // Ignore vibration errors on unsupported platforms
  }

  try {
    if (kind === 'scan_success') {
      // Discreet double-chirp optical scanner confirmation
      playToneSequence([
        { freq: 980, durationMs: 55, delayMs: 0, gain: 0.06, type: 'sine' },
        { freq: 1380, durationMs: 75, delayMs: 55, gain: 0.065, type: 'sine' },
      ]);
    } else if (kind === 'error') {
      // Low muted alert double-thud
      playToneSequence([
        { freq: 210, durationMs: 95, delayMs: 0, gain: 0.085, type: 'triangle' },
        { freq: 155, durationMs: 120, delayMs: 95, gain: 0.085, type: 'triangle' },
      ]);
    } else if (kind === 'sale_success') {
      // Crisp 3-note cash drawer / receipt chime
      playToneSequence([
        { freq: 587.33, durationMs: 70, delayMs: 0, gain: 0.055, type: 'sine' },
        { freq: 783.99, durationMs: 75, delayMs: 70, gain: 0.06, type: 'sine' },
        { freq: 1046.5, durationMs: 110, delayMs: 145, gain: 0.065, type: 'sine' },
      ]);
    }
  } catch {
    // Ignore audio context restrictions
  }
}
