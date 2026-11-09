// Relay, the Ferry mascot, in a few lines of text: shown in terminals while
// files are compared by content. Every frame has the same width, so it can be
// redrawn in place.
//
//     ╭─────╮
//    ╭╯•ᴗ•  ╰╮   [≡] ⇠ [≡]   Relay is comparing files…
//    ╰≈~≈~≈~≈╯   ▰▰▰▰▱▱▱▱▱▱▱▱  120/800
//
// Relay's eyes glance from one file to the other; its scarf ripples.

export interface ArtStyle {
  body: (s: string) => string; // Relay's outline and face
  scarf: (s: string) => string;
  active: (s: string) => string; // the file Relay is looking at
  muted: (s: string) => string;
  bar: (s: string) => string;
}

export const plainStyle: ArtStyle = { body: (s) => s, scarf: (s) => s, active: (s) => s, muted: (s) => s, bar: (s) => s };

const BAR = 12;

/** Three lines of Relay comparing two files. frame advances the animation; total 0 means "unknown". */
export function comparingArt(frame: number, done: number, total: number, label = "Relay is comparing files…", st: ArtStyle = plainStyle): string[] {
  const left = Math.floor(frame / 4) % 2 === 0; // look at each file for four frames
  const face = left ? "•ᴗ•  " : "  •ᴗ•";
  const wave = frame % 2 === 0 ? "≈~≈~≈~≈" : "~≈~≈~≈~";
  const docL = left ? st.active("[≡]") : st.muted("[≡]");
  const docR = left ? st.muted("[≡]") : st.active("[≡]");
  const arrow = left ? "⇠" : "⇢";
  const filled = total > 0 ? Math.round((done / total) * BAR) : frame % (BAR + 1);
  const bar = st.bar("▰".repeat(filled)) + st.muted("▱".repeat(BAR - filled));
  const count = total > 0 ? st.muted(` ${done}/${total}`) : "";
  return [
    st.body("  ╭─────╮"),
    st.body(" ╭╯") + st.body(face) + st.body("╰╮") + `   ${docL} ${st.muted(arrow)} ${docR}   ${label}`,
    st.body(" ╰") + st.scarf(wave) + st.body("╯") + `   ${bar}${count}`,
  ];
}

/**
 * Draws comparingArt on a terminal stream and redraws it in place. Does
 * nothing when the stream isn't a terminal (pipes, CI logs, --json).
 */
export class ComparingSpinner {
  private shown = 0; // lines currently on screen
  private frame = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private done = 0;
  private total = 0;
  private label = "Relay is comparing files…";

  constructor(private out: NodeJS.WriteStream = process.stderr, private style: ArtStyle = plainStyle) {}

  get enabled(): boolean {
    return !!this.out.isTTY;
  }

  get active(): boolean {
    return this.timer !== null;
  }

  update(done: number, total: number, label?: string): void {
    if (!this.enabled) return;
    this.done = done;
    this.total = total;
    if (label) this.label = label;
    if (!this.timer) {
      this.timer = setInterval(() => {
        this.frame++;
        this.draw();
      }, 160);
      this.timer.unref?.();
    }
    this.draw();
  }

  /** Removes the art, e.g. before printing a log line; the next update draws it again. */
  clear(): void {
    if (this.shown === 0) return;
    this.out.write(`\x1b[${this.shown}F` + "\x1b[2K\n".repeat(this.shown) + `\x1b[${this.shown}F`);
    this.shown = 0;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.clear();
  }

  private draw(): void {
    const lines = comparingArt(this.frame, this.done, this.total, this.label, this.style);
    let s = this.shown > 0 ? `\x1b[${this.shown}F` : "";
    for (const l of lines) s += "\x1b[2K" + l + "\n";
    this.out.write(s);
    this.shown = lines.length;
  }
}
