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
