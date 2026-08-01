"use client";

// ─── PokerStack sound engine ──────────────────────────────────────────────────
//
// Everything here is synthesised live with the Web Audio API — there are no
// audio files to ship, decode or cache. Each effect is a short envelope over
// one or two oscillators plus (for the percussive sounds) a noise buffer.
//
// Browsers refuse to start an AudioContext until the user has interacted with
// the page, so the context is created lazily on the first sound and resumed
// opportunistically. Every call is wrapped in try/catch: audio is a garnish,
// it must never take the table down with it.

type MutedRef = { current: boolean };

export const MUTE_KEY = "pokerstack:muted";

/** Read the saved mute preference. Call from an effect — never during render. */
export function loadMuted(): boolean {
  if (typeof window === "undefined") return false;
  try { return window.localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; }
}

export function saveMuted(muted: boolean): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch {}
}

export interface Sounds {
  /** Crisp swoosh — one card leaving the dealer's hand. */
  deal(): void;
  /** Clay-on-clay click — a bet, call or raise. */
  chip(): void;
  /** Ascending fanfare — hero takes the pot. */
  win(): void;
  /** Low soft thud — cards mucked. */
  fold(): void;
  /** Urgent blip — action clock running out. `urgency` 0..1 raises the pitch. */
  timer(urgency?: number): void;
  /** Longer whoosh — flop, turn or river hitting the felt. */
  reveal(): void;
  /** Dramatic rising tone — someone shoves. */
  allin(): void;
  /** Two-note sting — blinds go up. */
  levelUp(): void;
  /** Descending tone — a player busts out. */
  eliminate(): void;
  /** Nudge the context awake after a user gesture. */
  unlock(): void;
}

export function makeSounds(mutedRef: MutedRef): Sounds {
  let ctx: AudioContext | null = null;

  function getCtx(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!ctx) {
      try {
        const Ctor = window.AudioContext
          || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return null;
        ctx = new Ctor();
      } catch { return null; }
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  }

  /** Live context only when a sound is actually allowed to play. */
  function audible(): AudioContext | null {
    if (mutedRef.current) return null;
    return getCtx();
  }

  /** Shared master trim so no single effect can clip the mix. */
  function out(c: AudioContext): GainNode {
    const g = c.createGain();
    g.gain.value = 0.9;
    g.connect(c.destination);
    return g;
  }

  /** White noise burst, `dur` seconds, with a linear fade to silence. */
  function noise(c: AudioContext, dur: number, shape: (t: number) => number): AudioBufferSourceNode {
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * shape(i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    return src;
  }

  /** Single enveloped oscillator. Returns immediately; audio runs on the graph. */
  function tone(
    c: AudioContext,
    { freq, to, dur, type = "sine", vol = 0.2, delay = 0, attack = 0.004 }:
    { freq: number; to?: number; dur: number; type?: OscillatorType; vol?: number; delay?: number; attack?: number },
  ): void {
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to !== undefined && to !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(out(c));
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  return {
    unlock() { getCtx(); },

    // Card sliding across felt: a noise burst pushed through a bandpass that
    // sweeps up, which is what gives it the "swish" rather than a dull "shh".
    deal() {
      const c = audible(); if (!c) return;
      try {
        const t0 = c.currentTime;
        const dur = 0.075;
        const src = noise(c, dur, t => (1 - t) ** 1.7);
        const bp = c.createBiquadFilter();
        bp.type = "bandpass";
        bp.Q.value = 1.1;
        bp.frequency.setValueAtTime(1300, t0);
        bp.frequency.exponentialRampToValueAtTime(4200, t0 + dur);
        const gain = c.createGain();
        gain.gain.setValueAtTime(0.5, t0);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        src.connect(bp); bp.connect(gain); gain.connect(out(c));
        src.start(t0);
      } catch {}
    },

    // Two clay chips knocking together: a bright transient over a short woody
    // body tone. The 12ms offset between them reads as one "clack", not two.
    chip() {
      const c = audible(); if (!c) return;
      try {
        const t0 = c.currentTime;
        const src = noise(c, 0.035, t => (1 - t) ** 4);
        const hp = c.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 1800;
        const g = c.createGain();
        g.gain.setValueAtTime(0.32, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.035);
        src.connect(hp); hp.connect(g); g.connect(out(c));
        src.start(t0);
        tone(c, { freq: 2400, to: 1500, dur: 0.03, type: "square", vol: 0.05 });
        tone(c, { freq: 620,  to: 380,  dur: 0.05, type: "triangle", vol: 0.09, delay: 0.012 });
      } catch {}
    },

    // Rising major arpeggio, each note a little louder and longer than the
    // last so the phrase lands rather than just stopping.
    win() {
      const c = audible(); if (!c) return;
      try {
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
          tone(c, { freq: f, dur: 0.3 + i * 0.09, type: "triangle", vol: 0.13 + i * 0.02, delay: i * 0.1 });
          tone(c, { freq: f * 2, dur: 0.2 + i * 0.06, type: "sine", vol: 0.045, delay: i * 0.1 });
        });
        // Final octave shimmer on the resolve.
        tone(c, { freq: 1567.98, dur: 0.5, type: "sine", vol: 0.07, delay: 0.42 });
      } catch {}
    },

    // Cards hitting the muck: pitch drops fast, plus a damped noise slap.
    fold() {
      const c = audible(); if (!c) return;
      try {
        const t0 = c.currentTime;
        tone(c, { freq: 190, to: 68, dur: 0.19, type: "triangle", vol: 0.2 });
        const src = noise(c, 0.09, t => (1 - t) ** 2.6);
        const lp = c.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 700;
        const g = c.createGain();
        g.gain.setValueAtTime(0.22, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
        src.connect(lp); lp.connect(g); g.connect(out(c));
        src.start(t0);
      } catch {}
    },

    // Action clock. Pitch and level climb as the clock runs down so the last
    // few seconds genuinely feel more urgent than the first.
    timer(urgency = 0) {
      const c = audible(); if (!c) return;
      try {
        const u = Math.min(1, Math.max(0, urgency));
        tone(c, { freq: 760 + u * 620, dur: 0.075 + u * 0.03, type: "square", vol: 0.055 + u * 0.075 });
      } catch {}
    },

    // Board card landing — same idea as deal() but longer, lower and wider,
    // so a street change is audibly a bigger event than a hole card.
    reveal() {
      const c = audible(); if (!c) return;
      try {
        const t0 = c.currentTime;
        const dur = 0.3;
        const src = noise(c, dur, t => Math.sin(Math.PI * t) ** 1.3);
        const bp = c.createBiquadFilter();
        bp.type = "bandpass";
        bp.Q.value = 0.8;
        bp.frequency.setValueAtTime(500, t0);
        bp.frequency.exponentialRampToValueAtTime(3400, t0 + dur * 0.8);
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.34, t0 + 0.07);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        src.connect(bp); bp.connect(g); g.connect(out(c));
        src.start(t0);
        tone(c, { freq: 280, to: 520, dur: 0.28, type: "sine", vol: 0.07 });
      } catch {}
    },

    // The shove. A slow sawtooth climb with a detuned partner for beating,
    // capped by a bright hit at the top of the ramp.
    allin() {
      const c = audible(); if (!c) return;
      try {
        tone(c, { freq: 175, to: 880, dur: 0.72, type: "sawtooth", vol: 0.12, attack: 0.09 });
        tone(c, { freq: 178, to: 892, dur: 0.72, type: "sawtooth", vol: 0.075, attack: 0.09 });
        tone(c, { freq: 1320, dur: 0.34, type: "triangle", vol: 0.13, delay: 0.68 });
        tone(c, { freq: 1760, dur: 0.28, type: "sine", vol: 0.07, delay: 0.7 });
      } catch {}
    },

    // Blinds up: a bright two-note call, deliberately short so it does not
    // collide with whatever else is happening on the table.
    levelUp() {
      const c = audible(); if (!c) return;
      try {
        tone(c, { freq: 784, dur: 0.17, type: "triangle", vol: 0.13 });
        tone(c, { freq: 1174.7, dur: 0.34, type: "triangle", vol: 0.13, delay: 0.15 });
        tone(c, { freq: 2349.3, dur: 0.22, type: "sine", vol: 0.05, delay: 0.15 });
      } catch {}
    },

    // Bust-out: the inverse of levelUp — falls instead of rising.
    eliminate() {
      const c = audible(); if (!c) return;
      try {
        tone(c, { freq: 440, to: 180, dur: 0.42, type: "triangle", vol: 0.14 });
        tone(c, { freq: 220, to: 90, dur: 0.5, type: "sine", vol: 0.09, delay: 0.06 });
      } catch {}
    },
  };
}
