// Button sounds and a little bounce, made with the Web Audio API (no sound files needed).
import { audioContext } from './engine/audio.js';
import { loadSettings } from './util.js';

let on = null;
export function sfxEnabled() {
  if (on === null) on = loadSettings().sfx !== false;
  return on;
}
export function setSfx(v) {
  on = !!v;
}

function tone(ctx, type, f0, f1, t, len, vol) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + len);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g);
  g.connect(ctx.destination);
  o.start(t);
  o.stop(t + len + 0.02);
}

// kind: 'tap' (normal), 'block' (menu buttons), 'ok' (main action), 'bad' (delete)
export function playSfx(kind = 'tap') {
  if (!sfxEnabled()) return;
  try {
    const ctx = audioContext();
    if (ctx.state === 'suspended') ctx.resume();
    const t = ctx.currentTime + 0.005;
    if (kind === 'block') {
      tone(ctx, 'square', 220, 440, t, 0.09, 0.12);
      tone(ctx, 'square', 330, 660, t + 0.06, 0.1, 0.1);
    } else if (kind === 'ok') {
      tone(ctx, 'sine', 520, 780, t, 0.1, 0.22);
      tone(ctx, 'sine', 780, 1170, t + 0.07, 0.14, 0.2);
    } else if (kind === 'bad') {
      tone(ctx, 'triangle', 260, 110, t, 0.16, 0.25);
    } else {
      tone(ctx, 'sine', 640, 960, t, 0.07, 0.2);
    }
  } catch {
    /* sound is optional */
  }
}

const SELECTOR = 'button, .tile, label.opt, .opt label, [role=button]';

export function installTapSounds() {
  document.addEventListener(
    'pointerdown',
    (e) => {
      const el = e.target && e.target.closest ? e.target.closest(SELECTOR) : null;
      if (!el || el.disabled) return;
      let kind = 'tap';
      if (el.classList.contains('mc-btn')) kind = 'block';
      else if (el.classList.contains('primary') || el.classList.contains('exp-btn') || el.classList.contains('rb-btn')) kind = 'ok';
      else if (el.classList.contains('danger') || el.classList.contains('del')) kind = 'bad';
      playSfx(kind);
      el.classList.remove('pop');
      void el.offsetWidth;
      el.classList.add('pop');
    },
    true,
  );
  document.addEventListener('animationend', (e) => {
    if (e.animationName === 'pop-bounce') e.target.classList.remove('pop');
  });
}
