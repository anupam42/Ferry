// A small terminal toolkit for the dashboard: styles, width-aware text,
// boxes, key parsing and a screen that redraws only the lines that changed.

// ---------- colors ----------

type ColorDepth = "none" | "16" | "256" | "truecolor";

function detectDepth(): ColorDepth {
  const env = process.env;
  if (env.NO_COLOR) return "none";
  const ct = (env.COLORTERM ?? "").toLowerCase();
  if (ct === "truecolor" || ct === "24bit") return "truecolor";
  if (env.WT_SESSION || process.platform === "win32") return "truecolor";
  if (["iTerm.app", "WezTerm", "vscode", "Hyper", "ghostty"].includes(env.TERM_PROGRAM ?? "")) return "truecolor";
  if ((env.TERM ?? "").includes("256")) return "256";
  return "16";
}

const depth: ColorDepth = detectDepth();
let dark = true;

export function setDarkBackground(d: boolean): void {
  dark = d;
}
export function hasDarkBackground(): boolean {
  return dark;
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function to256(r: number, g: number, b: number): number {
  const q = (v: number) => (v < 48 ? 0 : v < 115 ? 1 : Math.floor((v - 35) / 40));
  return 16 + 36 * q(r) + 6 * q(g) + q(b);
}

function to16(r: number, g: number, b: number): number {
  const bright = Math.max(r, g, b) > 170;
  const bit = (v: number) => (v > 100 ? 1 : 0);
  const idx = bit(r) | (bit(g) << 1) | (bit(b) << 2);
  return (bright ? 90 : 30) + (idx === 0 && bright ? 7 : idx);
}

function fgCode(hex: string): string {
  const [r, g, b] = rgb(hex);
  switch (depth) {
    case "truecolor": return `38;2;${r};${g};${b}`;
    case "256": return `38;5;${to256(r, g, b)}`;
    case "16": return String(to16(r, g, b));
    default: return "";
  }
}

/** A color that differs on light and dark backgrounds ("" = no color). */
export interface Adaptive {
  light: string;
  dark: string;
}

export interface StyleSpec {
  fg?: Adaptive | null;
  bold?: boolean;
  faint?: boolean;
  italic?: boolean;
  reverse?: boolean;
}

/** A text style; render() wraps text in the SGR codes. */
export class Style {
  constructor(public spec: StyleSpec = {}) {}

  with(more: StyleSpec): Style {
    return new Style({ ...this.spec, ...more });
  }

  private codes(): string {
    const c: string[] = [];
    if (this.spec.bold) c.push("1");
    if (this.spec.faint) c.push("2");
    if (this.spec.italic) c.push("3");
    if (this.spec.reverse) c.push("7");
    const fg = this.spec.fg;
    if (fg && depth !== "none") {
      const hex = dark ? fg.dark : fg.light;
      if (hex) c.push(fgCode(hex));
    }
    return c.filter(Boolean).join(";");
  }

  render(s: string): string {
    if (s === "") return s;
    const codes = this.codes();
    if (!codes) return s;
    // keep the style across inner resets
    return `\x1b[${codes}m${s.replaceAll("\x1b[0m", `\x1b[0m\x1b[${codes}m`)}\x1b[0m`;
  }
}

// ---------- text measurement ----------

// escape sequences start with the ESC control character (and OSC ones end with BEL): matching them is the point
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/y;
const segmenter = new Intl.Segmenter();

export function width(s: string): number {
  return Bun.stringWidth(s);
}

/** Cuts a (possibly styled) string to w cells. */
export function truncate(s: string, w: number): string {
  if (w <= 0) return "";
  if (width(s) <= w) return s;
  let out = "", used = 0, styled = false;
  let i = 0;
  while (i < s.length) {
    ANSI.lastIndex = i;
    const m = ANSI.exec(s);
    if (m) {
      out += m[0];
      styled = true;
      i += m[0].length;
      continue;
    }
    // the plain run up to the next escape
    let j = s.indexOf("\x1b", i + 1);
    if (j < 0) j = s.length;
    for (const { segment } of segmenter.segment(s.slice(i, j))) {
      const cw = width(segment);
      if (used + cw > w) return styled ? out + "\x1b[0m" : out;
      out += segment;
      used += cw;
    }
    i = j;
  }
  return out;
}

export function padRight(s: string, w: number): string {
  const n = w - width(s);
  return n > 0 ? s + " ".repeat(n) : s;
}

/** Cuts or pads to exactly w cells. */
export function fit(s: string, w: number): string {
  return padRight(truncate(s, w), w);
}

// ---------- boxes ----------

/**
 * A rounded box `total` cells wide (border and one cell of padding included).
 * With height, the content is padded or cut to that many lines.
 */
export function box(lines: string[], total: number, border: Style, height?: number): string[] {
  const inner = Math.max(0, total - 4);
  let content = lines;
  if (height !== undefined) {
    content = lines.slice(0, height);
    while (content.length < height) content.push("");
  }
  const side = border.render("│");
  const out = [border.render("╭" + "─".repeat(Math.max(0, total - 2)) + "╮")];
  for (const l of content) out.push(side + " " + fit(l, inner) + " " + side);
  out.push(border.render("╰" + "─".repeat(Math.max(0, total - 2)) + "╯"));
  return out;
}

/** Places blocks of lines side by side, padding each to its width. */
export function joinHorizontal(blocks: { lines: string[]; width: number }[]): string[] {
  const h = Math.max(...blocks.map((b) => b.lines.length));
  const out: string[] = [];
  for (let i = 0; i < h; i++) out.push(blocks.map((b) => fit(b.lines[i] ?? "", b.width)).join(""));
  return out;
}

// ---------- keys ----------

/** Splits raw terminal input into key names: "a", "enter", "up", "ctrl+c", "shift+tab", " "... */
export function parseKeys(data: string): string[] {
  const keys: string[] = [];
  let i = 0;
  while (i < data.length) {
    const c = data[i]!;
    if (c === "\x1b") {
      const n = data[i + 1];
      if (n === "[") {
        let j = i + 2;
        while (j < data.length && !/[@-~]/.test(data[j]!)) j++;
        const params = data.slice(i + 2, j);
        const fin = data[j] ?? "";
        i = j + 1;
        const base = params.split(";")[0];
        const map: Record<string, string> = { A: "up", B: "down", C: "right", D: "left", H: "home", F: "end", Z: "shift+tab" };
        if (fin === "~") {
          const tilde: Record<string, string> = { "1": "home", "7": "home", "4": "end", "8": "end", "3": "delete", "5": "pgup", "6": "pgdown", "2": "insert" };
          if (base && tilde[base]) keys.push(tilde[base]!);
        } else if (map[fin]) keys.push(map[fin]!);
        continue;
      }
      if (n === "O") {
        const map: Record<string, string> = { A: "up", B: "down", C: "right", D: "left", H: "home", F: "end" };
        const k = map[data[i + 2] ?? ""];
        if (k) keys.push(k);
        i += 3;
        continue;
      }
      if (n === "]") {
        // an OSC reply (e.g. to a background color query): skip it
        let j = i + 2;
        while (j < data.length && data[j] !== "\x07" && !(data[j] === "\x1b" && data[j + 1] === "\\")) j++;
        i = data[j] === "\x07" ? j + 1 : j + 2;
        continue;
      }
      if (n !== undefined && n !== "\x1b") {
        keys.push("alt+" + n);
        i += 2;
        continue;
      }
      keys.push("esc");
      i++;
      continue;
    }
    const code = c.charCodeAt(0);
    if (c === "\r" || c === "\n") keys.push("enter");
    else if (c === "\t") keys.push("tab");
    else if (c === "\x7f" || c === "\b") keys.push("backspace");
    else if (code < 0x20) keys.push("ctrl+" + String.fromCharCode(code + 96));
    else {
      const cp = data.codePointAt(i)!;
      const ch = String.fromCodePoint(cp);
      keys.push(ch);
      i += ch.length;
      continue;
    }
    i++;
  }
  return keys;
}

// ---------- screen ----------

/** The alternate screen, redrawn line by line. */
export class Screen {
  private prev: string[] = [];
  active = false;

  get width(): number {
    return process.stdout.columns || 80;
  }
  get height(): number {
    return process.stdout.rows || 24;
  }

  enter(): void {
    process.stdout.write("\x1b[?1049h\x1b[?25l\x1b[2J\x1b[H");
    this.prev = [];
    this.active = true;
  }

  leave(): void {
    if (!this.active) return;
    process.stdout.write("\x1b[0m\x1b[2J\x1b[H\x1b[?25h\x1b[?1049l");
    this.active = false;
  }

  /** Forgets what is on screen so the next draw repaints everything (after a resize). */
  invalidate(): void {
    this.prev = [];
    process.stdout.write("\x1b[2J");
  }

  draw(lines: string[]): void {
    const h = this.height, w = this.width;
    let buf = "";
    for (let row = 0; row < h; row++) {
      const line = truncate(lines[row] ?? "", w);
      if (this.prev[row] === line) continue;
      buf += `\x1b[${row + 1};1H${line}\x1b[0m\x1b[K`;
      this.prev[row] = line;
    }
    if (buf) process.stdout.write(buf);
  }
}

/**
 * Asks the terminal for its background color (OSC 11). Resolves to true for
 * dark, false for light, or null when the terminal doesn't answer.
 */
export function queryDarkBackground(timeoutMs = 150): Promise<boolean | null> {
  const env = process.env.COLORFGBG;
  if (env) {
    const bg = parseInt(env.split(";").pop() ?? "", 10);
    if (!Number.isNaN(bg)) return Promise.resolve(!(bg === 7 || bg >= 9));
  }
  return new Promise((resolve) => {
    let acc = "";
    const done = (v: boolean | null) => {
      clearTimeout(t);
      process.stdin.off("data", onData);
      resolve(v);
    };
    const onData = (d: Buffer) => {
      acc += d.toString("latin1");
      // eslint-disable-next-line no-control-regex -- the terminal's reply starts with ESC
      const m = /\x1b\]11;rgb:([0-9a-f]+)\/([0-9a-f]+)\/([0-9a-f]+)/i.exec(acc);
      if (m) {
        const v = (h: string) => parseInt(h.slice(0, 2), 16);
        const lum = 0.2126 * v(m[1]!) + 0.7152 * v(m[2]!) + 0.0722 * v(m[3]!);
        done(lum < 128);
      }
    };
    const t = setTimeout(() => done(null), timeoutMs);
    process.stdin.on("data", onData);
    process.stdout.write("\x1b]11;?\x07");
  });
}
