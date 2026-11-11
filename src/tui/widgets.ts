// A one-line text input and a scrolling viewport.
import { Style, truncate } from "./term.ts";

const segmenter = new Intl.Segmenter();
const graphemes = (s: string) => [...segmenter.segment(s)].map((x) => x.segment);

export class TextInput {
  private chars: string[] = [];
  private pos = 0;
  focused = false;

  constructor(
    public placeholder = "",
    public charLimit = 0,
  ) {}

  get value(): string {
    return this.chars.join("");
  }

  setValue(v: string): void {
    this.chars = graphemes(v);
    if (this.charLimit > 0) this.chars = this.chars.slice(0, this.charLimit);
    this.pos = this.chars.length;
  }

  focus(): void {
    this.focused = true;
  }
  blur(): void {
    this.focused = false;
  }

  /** Handles an editing key; returns false for keys it doesn't use. */
  update(key: string): boolean {
    switch (key) {
      case "left":
      case "ctrl+b":
        this.pos = Math.max(0, this.pos - 1);
        return true;
      case "right":
      case "ctrl+f":
        this.pos = Math.min(this.chars.length, this.pos + 1);
        return true;
      case "home":
      case "ctrl+a":
        this.pos = 0;
        return true;
      case "end":
      case "ctrl+e":
        this.pos = this.chars.length;
        return true;
      case "backspace":
      case "ctrl+h":
        if (this.pos > 0) this.chars.splice(--this.pos, 1);
        return true;
      case "delete":
      case "ctrl+d":
        this.chars.splice(this.pos, 1);
        return true;
      case "ctrl+u":
        this.chars.splice(0, this.pos);
        this.pos = 0;
        return true;
      case "ctrl+k":
        this.chars.splice(this.pos);
        return true;
      case "ctrl+w": {
        let i = this.pos;
        while (i > 0 && this.chars[i - 1] === " ") i--;
        while (i > 0 && this.chars[i - 1] !== " ") i--;
        this.chars.splice(i, this.pos - i);
        this.pos = i;
        return true;
      }
    }
    if ([...key].length === 1 && key >= " ") {
      if (this.charLimit > 0 && this.chars.length >= this.charLimit) return true;
      this.chars.splice(this.pos++, 0, key);
      return true;
    }
    return false;
  }

  view(muted: Style): string {
    const cursor = new Style({ reverse: true });
    if (this.chars.length === 0) {
      const ph = graphemes(this.placeholder);
      if (!this.focused) return muted.render(this.placeholder);
      return cursor.render(ph[0] ?? " ") + muted.render(ph.slice(1).join(""));
    }
    if (!this.focused) return this.value;
    const before = this.chars.slice(0, this.pos).join("");
    const at = this.chars[this.pos] ?? " ";
    const after = this.chars.slice(this.pos + 1).join("");
    return before + cursor.render(at) + after;
  }
}

export class Viewport {
  private lines: string[] = [];
  offset = 0;

  constructor(
    public width = 80,
    public height = 20,
  ) {}

  setContent(s: string): void {
    this.lines = s.replace(/\n$/, "").split("\n");
    this.clamp();
  }

  gotoTop(): void {
    this.offset = 0;
  }

  private maxOffset(): number {
    return Math.max(0, this.lines.length - this.height);
  }

  private clamp(): void {
    this.offset = Math.min(Math.max(0, this.offset), this.maxOffset());
  }

  scrollPercent(): number {
    const max = this.maxOffset();
    return max === 0 ? 1 : this.offset / max;
  }

  /** Handles a scrolling key; returns false for keys it doesn't use. */
  update(key: string): boolean {
    const half = Math.max(1, Math.floor(this.height / 2));
    switch (key) {
      case "up":
      case "k":
        this.offset--;
        break;
      case "down":
      case "j":
        this.offset++;
        break;
      case "pgup":
      case "b":
        this.offset -= this.height;
        break;
      case "pgdown":
      case "f":
      case " ":
        this.offset += this.height;
        break;
      case "u":
      case "ctrl+u":
        this.offset -= half;
        break;
      case "ctrl+d":
        this.offset += half;
        break;
      case "home":
      case "g":
        this.offset = 0;
        break;
      case "end":
      case "G":
        this.offset = this.maxOffset();
        break;
      default:
        return false;
    }
    this.clamp();
    return true;
  }

  view(): string[] {
    const out = this.lines.slice(this.offset, this.offset + this.height).map((l) => truncate(l, this.width));
    while (out.length < this.height) out.push("");
    return out;
  }
}
