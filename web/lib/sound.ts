// Relay's voice: tiny chirps made on the spot with Web Audio (no sound files). The speaker
// button mutes it, remembered as ferry-sound = "off".

let ctx: AudioContext | null = null;

export const soundOn = () => localStorage.getItem("ferry-sound") !== "off";
export function setSound(on: boolean): void {
  if (on) localStorage.removeItem("ferry-sound");
  else localStorage.setItem("ferry-sound", "off");
}

function audio(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null;
  ctx ??= new AudioContext();
  return ctx;
}

/** One chirp: a pitch that slides from `from` to `to` Hz, shaped like a quick "bip". */
function bip(a: AudioContext, at: number, from: number, to: number, len: number, vol = 0.14): void {
  const o = a.createOscillator(),
    g = a.createGain();
  o.type = "triangle";
  o.frequency.setValueAtTime(from, at);
  o.frequency.exponentialRampToValueAtTime(to, at + len * 0.7);
  // a little wobble at the end, like a voice
  const lfo = a.createOscillator(),
    depth = a.createGain();
  lfo.frequency.value = 18;
  depth.gain.value = to * 0.025;
  lfo.connect(depth).connect(o.frequency);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  o.connect(g).connect(a.destination);
  o.start(at);
  lfo.start(at);
  o.stop(at + len + 0.02);
  lfo.stop(at + len + 0.02);
}

const TUNES = {
  /** "hi-hi-ya!": two quick rising chirps and a happy one on top */
  hello: [
    [0, 620, 930, 0.1],
    [0.13, 760, 1140, 0.1],
    [0.29, 990, 1480, 0.22],
  ],
  /** a soft pop, for moving on */
  pop: [[0, 520, 780, 0.07, 0.08]],
  /** a little fanfare */
  party: [
    [0, 660, 990, 0.09],
    [0.1, 880, 1320, 0.09],
    [0.2, 1100, 1650, 0.09],
    [0.32, 1320, 1980, 0.24],
  ],
} as const;
export type Tune = keyof typeof TUNES;

function play(a: AudioContext, tune: Tune): void {
  const t0 = a.currentTime + 0.02;
  for (const [dt, f1, f2, len, vol] of TUNES[tune] as readonly (readonly number[])[])
    bip(a, t0 + dt!, f1!, f2!, len!, vol);
}

/**
 * Plays a chirp, unless muted. Browsers only allow sound after you've clicked or typed on the
 * page: until then it waits for the first click or key press and plays then (if `wait`), or not at all.
 * Returns false when it couldn't play straight away.
 */
export function chirp(tune: Tune, wait = false): boolean {
  if (!soundOn()) return true;
  const a = audio();
  if (!a) return true;
  if (a.state === "running") {
    play(a, tune);
    return true;
  }
  let done = false;
  const once = () => {
    if (!done && a.state === "running" && soundOn()) {
      done = true;
      play(a, tune);
    }
  };
  void a.resume().then(once);
  if (wait) {
    const go = () => {
      removeEventListener("pointerdown", go, true);
      removeEventListener("keydown", go, true);
      void a.resume().then(once);
    };
    addEventListener("pointerdown", go, true);
    addEventListener("keydown", go, true);
  }
  return false;
}

// ---------- the opening: a cinematic swell for Relay's introduction ----------

/** True when sound can play now (the browser allows it, or has just allowed it). */
export async function canPlay(): Promise<boolean> {
  const a = audio();
  if (!a) return false;
  if (a.state === "running") return true;
  await Promise.race([a.resume(), new Promise((r) => setTimeout(r, 200))]);
  // the state changed while we waited (TypeScript narrowed it to "not running" above)
  return (a.state as AudioContextState) === "running";
}

/** A big hall: an impulse of decaying noise, for the reverb. */
function hall(a: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(a.sampleRate * seconds),
    buf = a.createBuffer(2, len, a.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  return buf;
}

function noise(a: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(a.sampleRate * seconds),
    buf = a.createBuffer(1, len, a.sampleRate),
    d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/** A path around and over the listener for a 3D panner: `turns` circles in `seconds`, rising overhead. */
function orbit(p: PannerNode, at: number, seconds: number, turns: number, phase: number, r: number): void {
  const n = 64,
    xs = new Float32Array(n),
    ys = new Float32Array(n),
    zs = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1),
      ang = phase + k * turns * Math.PI * 2,
      rad = r * (1 - 0.7 * k); // closing in as the chord lands
    xs[i] = Math.cos(ang) * rad;
    zs[i] = Math.sin(ang) * rad;
    ys[i] = Math.sin(k * Math.PI) * 1.8; // over your head and back down
  }
  p.positionX.setValueCurveAtTime(xs, at, seconds);
  p.positionY.setValueCurveAtTime(ys, at, seconds);
  p.positionZ.setValueCurveAtTime(zs, at, seconds);
}

/** When the opening lands (s after it starts): the picture flashes into the first scene then. */
export const OPENING_HIT = 2.6;
/** How long the finished wordmark stays on screen after that, while the sound rings out, before the first scene. */
export const OPENING_HOLD = 2.5;
/** When Relay passes each letter of FERRY (s after the start): the picture and the harp agree on these. */
export const LETTER_AT = [0.75, 1.05, 1.35, 1.65, 1.95];

export type OpeningSound = "voyage" | "swell";
export const OPENINGS: readonly (readonly [OpeningSound, string])[] = [
  ["voyage", "Voyage: waves, a ferry's horn and a harp note for each letter"],
  ["swell", "Swell: a rising chord that circles around you"],
];
export const openingSound = (): OpeningSound =>
  localStorage.getItem("ferry-opening") === "swell" ? "swell" : "voyage";
export const setOpeningSound = (k: OpeningSound) => localStorage.setItem("ferry-opening", k);

/** What every opening plays through: a compressor, a big hall, and a way to stop it all. */
interface Rig {
  a: AudioContext;
  t0: number;
  hit: number;
  /** sends a sound out, with `send` of it into the hall */
  out: (node: AudioNode, send?: number) => void;
  stops: (() => void)[];
}

function rig(a: AudioContext): Rig & { stop: () => void } {
  const t0 = a.currentTime + 0.05;
  const master = a.createGain();
  master.gain.value = 0.5;
  const comp = a.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  master.connect(comp).connect(a.destination);
  const verb = a.createConvolver();
  verb.buffer = hall(a, 4.5);
  const wet = a.createGain();
  wet.gain.value = 0.55;
  verb.connect(wet).connect(master);
  const stops: (() => void)[] = [];
  return {
    a,
    t0,
    hit: t0 + OPENING_HIT,
    stops,
    out(node, send = 0.6) {
      node.connect(master);
      const s = a.createGain();
      s.gain.value = send;
      node.connect(s).connect(verb);
    },
    stop() {
      const now = a.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(0, now + 0.4);
      setTimeout(
        () =>
          stops.forEach((s) => {
            try {
              s();
            } catch {
              // already stopped
            }
          }),
        500,
      );
    },
  };
}

/** Relay's "hi-hi-ya" at `at`, in the hall. */
function relayHi(r: Rig, at: number): void {
  const { a } = r;
  const relay = a.createGain();
  r.out(relay, 0.8);
  for (const [dt, f1, f2, len] of TUNES.hello) {
    const t = at + dt,
      o = a.createOscillator(),
      g = a.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(f1, t);
    o.frequency.exponentialRampToValueAtTime(f2, t + len * 0.7);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(relay);
    o.start(t);
    o.stop(t + len + 0.02);
  }
}

/** Swell: voices that start anywhere and glide into one wide chord while circling you, then a boom and bells. */
function swell(r: Rig): void {
  const { a, t0, hit, out, stops } = r;
  // the voices: each starts somewhere random and glides to its note of an A major chord with a 9th
  const CHORD = [55, 110, 164.81, 220, 277.18, 329.63, 440, 493.88, 554.37, 659.25, 880, 1318.5];
  CHORD.forEach((to, i) => {
    const o = a.createOscillator(),
      f = a.createBiquadFilter(),
      g = a.createGain(),
      p = a.createPanner();
    o.type = "sawtooth";
    o.detune.value = (Math.random() - 0.5) * 14;
    const from = 180 + Math.random() * 260;
    o.frequency.setValueAtTime(from, t0);
    o.frequency.setValueAtTime(from, t0 + 0.4);
    o.frequency.exponentialRampToValueAtTime(to, hit - 0.15 + Math.random() * 0.2);
    f.type = "lowpass";
    f.frequency.setValueAtTime(300, t0);
    f.frequency.exponentialRampToValueAtTime(5200, hit);
    f.frequency.exponentialRampToValueAtTime(1800, hit + 4);
    const peak = (to < 120 ? 0.09 : 0.045) * (0.8 + Math.random() * 0.4);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak * 0.35, t0 + 1.2);
    g.gain.exponentialRampToValueAtTime(peak, hit);
    g.gain.setValueAtTime(peak, hit + 1.1);
    g.gain.exponentialRampToValueAtTime(0.0001, hit + 4.2);
    p.panningModel = "HRTF";
    p.distanceModel = "inverse";
    orbit(p, t0, OPENING_HIT + 1, 1 + (i % 3) * 0.5, (i / CHORD.length) * Math.PI * 2, 4);
    o.connect(f).connect(g).connect(p);
    out(p, 0.7);
    o.start(t0);
    o.stop(hit + 4.4);
    stops.push(() => o.stop());
  });

  // the whoosh under the swell
  const wh = a.createBufferSource(),
    bp = a.createBiquadFilter(),
    wg = a.createGain();
  wh.buffer = noise(a, OPENING_HIT + 0.5);
  bp.type = "bandpass";
  bp.Q.value = 0.9;
  bp.frequency.setValueAtTime(180, t0);
  bp.frequency.exponentialRampToValueAtTime(3200, hit);
  wg.gain.setValueAtTime(0.0001, t0);
  wg.gain.exponentialRampToValueAtTime(0.22, hit - 0.05);
  wg.gain.exponentialRampToValueAtTime(0.0001, hit + 0.12);
  wh.connect(bp).connect(wg);
  out(wg, 0.5);
  wh.start(t0);
  stops.push(() => wh.stop());

  // the boom as it lands: a deep drop and a soft thump
  const boom = a.createOscillator(),
    bg = a.createGain();
  boom.type = "sine";
  boom.frequency.setValueAtTime(92, hit);
  boom.frequency.exponentialRampToValueAtTime(34, hit + 1.4);
  bg.gain.setValueAtTime(0.0001, hit - 0.01);
  bg.gain.exponentialRampToValueAtTime(0.9, hit + 0.02);
  bg.gain.exponentialRampToValueAtTime(0.0001, hit + 2.2);
  boom.connect(bg);
  out(bg, 0.3);
  boom.start(hit - 0.01);
  boom.stop(hit + 2.3);
  stops.push(() => boom.stop());

  // shimmering bells, left and right
  [1760, 2637, 3520, 2217].forEach((hz, i) => {
    const o = a.createOscillator(),
      g = a.createGain(),
      pan = a.createStereoPanner();
    o.type = "sine";
    o.frequency.value = hz;
    const at = hit + 0.08 + i * 0.11;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.05, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 2.4);
    pan.pan.value = i % 2 ? 0.7 : -0.7;
    o.connect(g).connect(pan);
    out(pan, 1);
    o.start(at);
    o.stop(at + 2.5);
    stops.push(() => o.stop());
  });

  relayHi(r, hit + 0.42);
}

/** A plucked string: a bright attack that dies away, like a harp. */
function pluck(r: Rig, at: number, hz: number, pan: number, vol = 0.16): void {
  const { a, out, stops } = r;
  const p = a.createStereoPanner();
  p.pan.value = pan;
  for (const [mult, v, type] of [
    [1, 1, "triangle"],
    [2, 0.35, "sine"],
    [3, 0.12, "sine"],
  ] as const) {
    const o = a.createOscillator(),
      g = a.createGain();
    o.type = type;
    o.frequency.value = hz * mult;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol * v, at + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 1.8 / mult);
    o.connect(g).connect(p);
    o.start(at);
    o.stop(at + 1.9);
    stops.push(() => o.stop());
  }
  out(p, 0.75);
}

/**
 * Voyage: waves washing from left to right as Relay flies across, a warm horn chord like a ferry's
 * rising under them, a harp note for each letter of FERRY as it appears (from where it is on
 * screen), then a sparkle and Relay's hi.
 */
function voyage(r: Rig): void {
  const { a, t0, hit, out, stops } = r;

  // the sea: noise through a soft filter, swelling and ebbing like waves, travelling left to right
  const sea = a.createBufferSource(),
    lp = a.createBiquadFilter(),
    sg = a.createGain(),
    sp = a.createStereoPanner();
  sea.buffer = noise(a, OPENING_HIT + 3);
  lp.type = "lowpass";
  lp.Q.value = 0.6;
  lp.frequency.setValueAtTime(350, t0);
  lp.frequency.linearRampToValueAtTime(1400, hit);
  lp.frequency.exponentialRampToValueAtTime(500, hit + 2.5);
  const waves = new Float32Array(48);
  for (let i = 0; i < waves.length; i++) {
    const k = i / (waves.length - 1);
    waves[i] = (0.03 + 0.11 * Math.pow(Math.sin(k * Math.PI * 2.5), 2)) * Math.min(1, k * 4) * (1 - k * 0.6);
  }
  sg.gain.setValueAtTime(0.0001, t0);
  sg.gain.setValueCurveAtTime(waves, t0 + 0.01, OPENING_HIT + 2.8);
  sp.pan.setValueAtTime(-0.8, t0);
  sp.pan.linearRampToValueAtTime(0.8, t0 + 2.3);
  sp.pan.linearRampToValueAtTime(0, hit + 0.5);
  sea.connect(lp).connect(sg).connect(sp);
  out(sp, 0.4);
  sea.start(t0);
  stops.push(() => sea.stop());

  // the horn: a warm, low D chord (root, fifth, octave) breathing in, a little out of tune like a real one
  for (const [hz, v] of [
    [73.42, 0.16],
    [110, 0.11],
    [146.83, 0.08],
    [220, 0.04],
  ] as const) {
    for (const det of [-7, 6]) {
      const o = a.createOscillator(),
        f = a.createBiquadFilter(),
        g = a.createGain();
      o.type = "sawtooth";
      o.frequency.value = hz;
      o.detune.value = det;
      f.type = "lowpass";
      f.frequency.setValueAtTime(220, t0 + 0.2);
      f.frequency.exponentialRampToValueAtTime(900, hit);
      f.frequency.exponentialRampToValueAtTime(260, hit + 3);
      g.gain.setValueAtTime(0.0001, t0 + 0.2);
      g.gain.exponentialRampToValueAtTime(v * 0.5, t0 + 1.4);
      g.gain.exponentialRampToValueAtTime(v, hit);
      g.gain.exponentialRampToValueAtTime(0.0001, hit + 3.2);
      o.connect(f).connect(g);
      out(g, 0.5);
      o.start(t0 + 0.2);
      o.stop(hit + 3.3);
      stops.push(() => o.stop());
    }
  }

  // a harp note for each letter, rising, from left to right like the letters
  const NOTES = [587.33, 739.99, 880, 1174.66, 1479.98]; // D, F#, A, D, F#
  LETTER_AT.forEach((dt, i) => pluck(r, t0 + dt, NOTES[i]!, -0.7 + i * 0.35));

  // landing: a soft low thump and a sparkle of high notes all at once, spread wide
  const thump = a.createOscillator(),
    tg = a.createGain();
  thump.type = "sine";
  thump.frequency.setValueAtTime(110, hit);
  thump.frequency.exponentialRampToValueAtTime(45, hit + 0.6);
  tg.gain.setValueAtTime(0.0001, hit - 0.01);
  tg.gain.exponentialRampToValueAtTime(0.55, hit + 0.015);
  tg.gain.exponentialRampToValueAtTime(0.0001, hit + 1.2);
  thump.connect(tg);
  out(tg, 0.3);
  thump.start(hit - 0.01);
  thump.stop(hit + 1.3);
  stops.push(() => thump.stop());
  [2349.32, 2959.96, 3520, 4698.63].forEach((hz, i) => pluck(r, hit + i * 0.045, hz, i % 2 ? 0.6 : -0.6, 0.06));

  relayHi(r, hit + 0.38);
}

/**
 * Plays the opening chosen in Settings → About (Voyage unless you picked Swell). Spatial: best
 * with headphones. Returns a stop that fades it out.
 */
export function opening(kind: OpeningSound = openingSound()): () => void {
  const a = audio();
  if (!a || a.state !== "running" || !soundOn()) return () => {};
  const r = rig(a);
  (kind === "swell" ? swell : voyage)(r);
  return r.stop;
}
