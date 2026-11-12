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

/** When the opening's chord lands (s after it starts): the picture flashes into the first scene then. */
export const OPENING_HIT = 2.6;

/**
 * Plays the opening: a rising, swirling swell of voices that glide into one wide chord (with a
 * whoosh under them), a deep boom and shimmering bells as it lands, then Relay's "hi-hi-ya" in
 * a big hall. Every voice moves around you in 3D (best with headphones). Returns a stop that fades it out.
 */
export function opening(): () => void {
  const a = audio();
  if (!a || a.state !== "running" || !soundOn()) return () => {};
  const t0 = a.currentTime + 0.05,
    hit = t0 + OPENING_HIT;

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
  const out = (node: AudioNode, send = 0.6) => {
    node.connect(master);
    const s = a.createGain();
    s.gain.value = send;
    node.connect(s).connect(verb);
  };
  const stops: (() => void)[] = [];

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

  // and Relay, in the hall
  const relay = a.createGain();
  relay.gain.value = 1;
  out(relay, 0.8);
  for (const [dt, f1, f2, len] of TUNES.hello) {
    const at = hit + 0.42 + dt,
      o = a.createOscillator(),
      g = a.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(f1, at);
    o.frequency.exponentialRampToValueAtTime(f2, at + len * 0.7);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.2, at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    o.connect(g).connect(relay);
    o.start(at);
    o.stop(at + len + 0.02);
  }

  return () => {
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
  };
}
