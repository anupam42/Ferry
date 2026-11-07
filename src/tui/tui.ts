// The interactive dashboard.
import fs from "node:fs";
import path from "node:path";

import type { Line } from "../difftext.ts";
import { summarizeStatus, type Engine } from "../engine/engine.ts";
import { counts, type Batch } from "../engine/journal.ts";
import { isPaused, parseChoice, stateOf, type ChangedFile, type Event, type Kind, type Status } from "../engine/types.ts";
import * as gitx from "../gitx.ts";
import { execInteractive, isMac, isWindows, startDetached, which } from "../proc.ts";
import { errMsg, fmtClock, fmtDateTime } from "../util.ts";
import { renderDiff } from "./diffview.ts";
import { box, joinHorizontal, parseKeys, queryDarkBackground, Screen, Style, truncate, width } from "./term.ts";
import { nextTheme, setAutoDark, setTheme, theme } from "./theme.ts";
import { TextInput, Viewport } from "./widgets.ts";

type Mode = "main" | "diff" | "commit" | "help" | "search" | "history";

interface Row {
  text: string;
  path: string; // empty for directory rows
  kind: Kind;
  dir: string;
  conflict: boolean;
  depth: number;
}

function kindStyle(k: Kind): [string, Style] {
  const t = theme();
  const s = (fg: typeof t.green, bold = false) => new Style({ fg, bold });
  switch (k) {
    case "add": return ["+", s(t.green)];
    case "update": return ["~", s(t.yellow)];
    case "delete": return ["-", s(t.red)];
    case "rename": return ["↻", s(t.purple)];
    case "conflict": return ["!", s(t.red, true)];
    case "resolved": case "resumed": return ["✓", s(t.green)];
    case "error": return ["✗", s(t.red, true)];
    case "warn": case "paused": return ["⚠", s(t.yellow)];
    case "skip": return ["·", t.muted];
    case "kept": return ["◇", s(t.cyan)];
    case "commit": return ["●", s(t.green, true)];
    case "synced": case "git": return ["⇄", s(t.cyan)];
  }
  return ["•", s(t.accent)];
}

function opStyle(op: string): [string, Style] {
  if (op === "add") return kindStyle("add");
  if (op === "delete") return kindStyle("delete");
  if (op === "rename") return kindStyle("rename");
  return kindStyle("update");
}

function matches(filter: string, ...parts: (string | undefined)[]): boolean {
  if (filter === "") return true;
  const f = filter.toLowerCase();
  return parts.some((p) => p?.toLowerCase().includes(f));
}

const orDash = (s: string) => (s === "" ? "–" : s);

export function buildRows(st: Status, filter: string): Row[] {
  const conf = new Set(st.conflicts);
  const files = new Map<string, ChangedFile>(st.changed.map((c) => [c.path, c]));
  for (const c of conf) if (!files.has(c)) files.set(c, { path: c, kind: "conflict", dir: "", time: 0 });
  // conflicts first, then alphabetical
  const paths = [...files.keys()]
    .filter((p) => matches(filter, p))
    .sort((a, b) => (conf.has(a) !== conf.has(b) ? (conf.has(a) ? -1 : 1) : a < b ? -1 : a > b ? 1 : 0));
  const rows: Row[] = [];
  const seen = new Set<string>();
  for (const p of paths) {
    const f = files.get(p)!;
    if (conf.has(p)) {
      rows.push({ text: p, path: p, kind: "conflict", dir: "", conflict: true, depth: 0 });
      continue;
    }
    const parts = p.split("/");
    const dirs = parts.slice(0, -1);
    dirs.forEach((part, i) => {
      const d = dirs.slice(0, i + 1).join("/");
      if (!seen.has(d)) {
        seen.add(d);
        rows.push({ text: part + "/", path: "", kind: "info", dir: "", conflict: false, depth: i });
      }
    });
    rows.push({ text: parts[parts.length - 1]!, path: p, kind: f.kind, dir: f.dir, conflict: false, depth: dirs.length });
  }
  return rows;
}

const HELP = `
  Navigation
    tab / ]       next pair            shift+tab / [   previous pair
    ↑ ↓ / k j     select file          PgUp PgDn       scroll activity log
    End / G       follow log           q / ctrl+c      quit
    /             filter files and activity (esc clears)

  Sync
    p / space     pause or resume the selected pair
    r             full resync (compare every file by content)
    y             approve a large batch waiting for confirmation
    H             sync history; u (twice) undoes the newest batch

  Files
    d / enter     diff selected file (vs last commit, or source vs target for a conflict)
                  in the diff: v toggles side-by-side
    e             open the file in $EDITOR, VS Code or the default app
    i             stop syncing the selected file (adds it to the source's .syncignore)

  Conflicts (two-way mode, select a ! file)
    s  keep source     t  keep target     n  keep newer     b  keep both
    m  three-way merge (overlapping edits get <<<<<<< markers)

  Git
    a  stage / unstage the selected file
    c  commit (only staged files if anything is staged, else everything)
    C  commit and push

  Look
    T  cycle theme: auto → dark → light → mono

  Legend:  + added  ~ updated  - deleted  ↻ renamed  ◇ kept (deleted on the other side)
           ! conflict  → to target  ← to source  ⇄ merged

  press any key to go back`;

export class Dashboard {
  private statuses: Status[] = [];
  private sel = 0;
  private fileSel = 0;
  private rows: Row[] = [];
  private logs: Event[] = [];
  private logOff = 0; // lines scrolled up from the bottom

  private mode: Mode = "main";
  private vp = new Viewport(80, 20);
  private title = "";
  private input = new TextInput("commit message", 200);
  private search = new TextInput("filter files and activity", 100);
  private push = false;
  private staged = false; // commit only what's staged
  private flash = "";
  private flashAt = 0;
  private filter = "";
  private diffLines: Line[] = [];
  private diffPath = "";
  private sideBySide = false;
  private batches: Batch[] = [];
  private undoArmed = false;

  private screen = new Screen();
  private renderQueued = false;
  private suspended = false;
  private quit: (() => void) | null = null;

  constructor(private engines: Engine[], private version: string, themeName: string) {
    setTheme(themeName || "auto");
    this.refresh();
  }

  /** Delivers an engine event (shown in the activity log). */
  addEvent(ev: Event): void {
    if (ev.kind === "git") return; // shown in the files panel instead
    this.logs.push(ev);
    if (this.logs.length > 2000) this.logs = this.logs.slice(-2000);
    if (this.logOff > 0) this.logOff++; // keep the view stable while scrolled up
    this.requestRender();
  }

  /** Runs until the user quits or signal is aborted. */
  async run(signal: AbortSignal): Promise<void> {
    const stdin = process.stdin;
    stdin.setRawMode?.(true);
    stdin.resume();
    const dark = await queryDarkBackground();
    if (dark !== null) setAutoDark(dark);
    this.screen.enter();
    const onData = (d: Buffer) => {
      if (this.suspended) return;
      for (const k of parseKeys(d.toString("utf8"))) void this.handleKey(k);
      this.requestRender();
    };
    const onResize = () => {
      this.screen.invalidate();
      this.requestRender();
    };
    stdin.on("data", onData);
    process.stdout.on("resize", onResize);
    const tick = setInterval(() => {
      this.refresh();
      this.requestRender();
    }, 500);
    const restore = () => this.screen.leave();
    process.on("exit", restore);
    this.render();
    try {
      await new Promise<void>((resolve) => {
        this.quit = resolve;
        if (signal.aborted) resolve();
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
    } finally {
      clearInterval(tick);
      stdin.off("data", onData);
      process.stdout.off("resize", onResize);
      process.off("exit", restore);
      this.screen.leave();
      stdin.setRawMode?.(false);
      stdin.pause();
    }
  }

  private requestRender(): void {
    if (this.renderQueued || this.suspended) return;
    this.renderQueued = true;
    setTimeout(() => {
      this.renderQueued = false;
      this.render();
    }, 16);
  }

  private render(): void {
    if (this.suspended || !this.screen.active) return;
    this.vp.width = this.screen.width - 4;
    this.vp.height = Math.max(1, this.screen.height - 5);
    this.screen.draw(this.view());
  }

  private refresh(): void {
    this.statuses = this.engines.map((e) => e.getStatus());
    if (this.sel >= this.statuses.length) this.sel = 0;
    this.rows = buildRows(this.statuses[this.sel]!, this.filter);
    if (this.fileSel >= this.rows.length) this.fileSel = this.rows.length - 1;
    if (this.fileSel < 0) this.fileSel = 0;
  }

  private say(s: string): void {
    this.flash = s;
    this.flashAt = Date.now();
    this.requestRender();
    setTimeout(() => this.requestRender(), 3050);
  }

  private flashing(): boolean {
    return this.flash !== "" && Date.now() - this.flashAt < 3000;
  }

  private selectedRow(): Row | null {
    return this.rows[this.fileSel] ?? null;
  }

  private showDiff(title: string, rel: string, lines: Line[]): void {
    this.title = title;
    this.diffPath = rel;
    this.diffLines = lines;
    this.vp.setContent(renderDiff(lines, rel, this.sideBySide, this.vp.width));
    this.vp.gotoTop();
    this.mode = "diff";
    this.requestRender();
  }

  private showHistory(batches: Batch[], note = ""): void {
    this.batches = batches;
    this.undoArmed = false;
    if (note) this.say(note);
    this.vp.setContent(this.renderHistory());
    this.vp.gotoTop();
    this.mode = "history";
    this.requestRender();
  }

  // ---------- keys ----------

  private async handleKey(k: string): Promise<void> {
    if (k === "ctrl+c") return this.quit?.();
    const e = this.engines[this.sel]!;
    switch (this.mode) {
      case "help":
        this.mode = "main";
        return;
      case "diff":
        if (["esc", "q", "d", "enter"].includes(k)) this.mode = "main";
        else if (k === "v") {
          this.sideBySide = !this.sideBySide;
          this.vp.setContent(renderDiff(this.diffLines, this.diffPath, this.sideBySide, this.vp.width));
        } else this.vp.update(k);
        return;
      case "history":
        if (["esc", "q", "H"].includes(k)) this.mode = "main";
        else if (k === "u") {
          if (!this.undoArmed) {
            this.undoArmed = true;
            this.say("press u again to undo the newest batch (backups are kept)");
            return;
          }
          this.undoArmed = false;
          try {
            const { batch, problems } = e.undoLast();
            let note = `undid the batch from ${fmtClock(new Date(batch.time))}`;
            if (problems.length > 0) note += ` (${problems.length} file(s) couldn't be restored: ${problems[0]})`;
            this.showHistory(e.history(), note);
          } catch (err) {
            this.say("undo: " + errMsg(err));
          }
        } else this.vp.update(k);
        return;
      case "search":
        if (k === "esc") {
          this.mode = "main";
          this.filter = "";
          this.search.blur();
          this.refresh();
        } else if (k === "enter") {
          this.mode = "main";
          this.search.blur();
        } else {
          this.search.update(k);
          this.filter = this.search.value.trim();
          this.fileSel = 0;
          this.refresh();
        }
        return;
      case "commit":
        if (k === "esc") {
          this.mode = "main";
          this.input.blur();
        } else if (k === "enter") {
          const msg = this.input.value.trim() || this.input.placeholder;
          if (this.staged) e.commitStaged(msg, this.push);
          else e.commit(msg, this.push);
          this.mode = "main";
          this.input.blur();
          this.say("committing…");
        } else this.input.update(k);
        return;
    }

    const st = this.statuses[this.sel]!;
    switch (k) {
      case "q":
        return this.quit?.();
      case "?":
      case "h":
        this.mode = "help";
        return;
      case "esc":
        if (this.filter !== "") {
          this.filter = "";
          this.search.setValue("");
          this.refresh();
        }
        return;
      case "/":
        this.mode = "search";
        this.search.setValue(this.filter);
        this.search.focus();
        return;
      case "tab":
      case "]":
        this.sel = (this.sel + 1) % this.engines.length;
        this.fileSel = 0;
        this.refresh();
        return;
      case "shift+tab":
      case "[":
        this.sel = (this.sel - 1 + this.engines.length) % this.engines.length;
        this.fileSel = 0;
        this.refresh();
        return;
      case "up":
      case "k":
        for (let i = this.fileSel - 1; i >= 0; i--) {
          if (this.rows[i]!.path !== "") {
            this.fileSel = i;
            break;
          }
        }
        return;
      case "down":
      case "j":
        for (let i = this.fileSel + 1; i < this.rows.length; i++) {
          if (this.rows[i]!.path !== "") {
            this.fileSel = i;
            break;
          }
        }
        return;
      case "pgup":
        this.logOff += 10;
        return;
      case "pgdown":
        this.logOff = Math.max(0, this.logOff - 10);
        return;
      case "end":
      case "G":
        this.logOff = 0;
        return;
      case "p":
      case " ":
        e.togglePause();
        this.say("toggled pause");
        return;
      case "r":
        e.resync();
        this.say("full resync requested");
        return;
      case "y":
        if (st.pendingBatch > 0) {
          e.approveBatch();
          this.say("batch approved");
        }
        return;
      case "T":
        setTheme(nextTheme());
        this.screen.invalidate();
        this.say("theme: " + theme().name);
        return;
      case "H":
        this.showHistory(e.history());
        return;
      case "c":
      case "C":
        if (!st.isGit) {
          this.say("target is not a git repo");
          return;
        }
        this.push = k === "C";
        this.staged = gitx.stagedCount(st.gitStatus) > 0;
        this.mode = "commit";
        this.input.setValue("");
        this.input.placeholder = "sync: " + summarizeStatus(st.gitStatus);
        this.input.focus();
        return;
    }

    const r = this.selectedRow();
    switch (k) {
      case "a": {
        if (!r || r.path === "") return this.say("select a file first (↑/↓)");
        if (!st.isGit) return this.say("target is not a git repo");
        try {
          const staged = await e.toggleStage(r.path);
          this.say(staged ? `staged ${r.path} — c commits only staged files` : `unstaged ${r.path}`);
        } catch (err) {
          this.say("stage: " + errMsg(err));
        }
        return;
      }
      case "i": {
        if (!r || r.path === "") return this.say("select a file first (↑/↓)");
        try {
          const line = e.ignorePath(r.path);
          this.say(line ? `ignoring ${r.path} from now on (added ${line} to the source's .syncignore; copies already made stay)` : `${r.path} is already in .syncignore`);
        } catch (err) {
          this.say("ignore: " + errMsg(err));
        }
        return;
      }
      case "e": {
        if (!r || r.path === "") return this.say("select a file first (↑/↓)");
        let p = e.targetPath(r.path);
        if (!fs.existsSync(p)) p = e.sourcePath(r.path);
        await this.openInEditor(p);
        return;
      }
      case "d":
      case "enter": {
        if (!r || r.path === "") return this.say("select a file first (↑/↓)");
        const { title, lines } = await e.diff(r.path, r.conflict);
        this.showDiff(title, r.path, lines);
        return;
      }
      case "s":
      case "t":
      case "n":
      case "b":
      case "m": {
        if (!r || !r.conflict) return this.say("select a conflict (!) to resolve");
        const choice = parseChoice(k)!;
        e.resolve(r.path, choice);
        this.say(`resolving ${r.path} → ${choice}`);
        return;
      }
    }
  }

  /** Opens p in $VISUAL/$EDITOR (in this terminal), or else in VS Code or the OS default app. */
  private async openInEditor(p: string): Promise<void> {
    const ed = (process.env.VISUAL || process.env.EDITOR || "").trim();
    if (ed) {
      const parts = ed.split(/\s+/);
      this.suspended = true;
      this.screen.leave();
      process.stdin.setRawMode?.(false);
      let code = 0;
      try {
        code = await execInteractive([...parts, p]);
      } catch (err) {
        code = -1;
        this.flash = "editor: " + errMsg(err);
        this.flashAt = Date.now();
      }
      process.stdin.setRawMode?.(true);
      process.stdin.resume();
      this.screen.enter();
      this.suspended = false;
      if (code !== 0 && code !== -1) this.say(`editor exited with status ${code}`);
      this.requestRender();
      return;
    }
    const code = which("code");
    const cmd = code ? [code, "-g", p] : isMac ? ["open", p] : isWindows ? ["rundll32", "url.dll,FileProtocolHandler", p] : ["xdg-open", p];
    this.say(startDetached(cmd) ? "opened " + path.basename(p) : "open: couldn't start " + cmd[0]);
  }

  // ---------- view ----------

  private view(): string[] {
    const w = this.screen.width, h = this.screen.height;
    const t = theme();
    if (this.mode === "help") {
      return [t.title.render(" ferry help") + t.muted.render("  theme: " + t.name), ...HELP.split("\n")];
    }
    if (this.mode === "diff") {
      const layout = this.sideBySide ? "side by side" : "unified";
      const head = t.title.render(" diff ") + " " + t.bold.render(this.title);
      const foot = t.muted.render(` ↑/↓ PgUp/PgDn scroll · v ${layout} · esc back · ${Math.round(this.vp.scrollPercent() * 100)}%`);
      return [head, ...box(this.vp.view(), w, t.borderActive), foot];
    }
    if (this.mode === "history") {
      const head = t.title.render(" history ") + " " + t.bold.render(this.statuses[this.sel]!.name);
      const foot = this.flashing() ? " " + t.flash.render(this.flash) : t.muted.render(" ↑/↓ scroll · u undo newest batch · esc back");
      return [head, ...box(this.vp.view(), w, t.borderActive), foot];
    }
    const header = this.headerView(w);
    const pairs = this.pairsView(w);
    const footer = this.footerView(w);
    const bodyH = Math.max(6, h - 1 - pairs.length - 1);
    const leftW = Math.max(30, Math.floor((w * 45) / 100));
    const rightW = w - leftW;
    const body = joinHorizontal([
      { lines: this.filesView(leftW, bodyH), width: leftW },
      { lines: this.logView(rightW, bodyH), width: rightW },
    ]);
    return [header, ...pairs, ...body, footer];
  }

  private headerView(w: number): string {
    const t = theme();
    const left = t.title.render("⇄ ferry") + t.muted.render(" " + this.version);
    const right = t.muted.render(`${this.engines.length} pair(s) · ? help · q quit`);
    return left + " ".repeat(Math.max(1, w - width(left) - width(right) - 1)) + right;
  }

  private pairsView(w: number): string[] {
    const t = theme();
    const lines = this.statuses.map((st, i) => {
      let icon = "●", style = new Style({ fg: t.green });
      let state = stateOf(st);
      if (st.conflicts.length > 0) [icon, style] = ["!", new Style({ fg: t.red, bold: true })];
      else if (st.pendingBatch > 0) [icon, style, state] = ["?", new Style({ fg: t.yellow }), state + " (y)"];
      else if (isPaused(st)) [icon, style] = ["‖", new Style({ fg: t.yellow })];
      else if (st.pending) [icon, style] = ["◌", new Style({ fg: t.cyan })];
      const branch = st.isGit ? " ⎇ " + orDash(st.branch) : "";
      const last = st.lastSync ? fmtClock(new Date(st.lastSync)) : "never";
      let name = st.name;
      if (st.remote) name += t.muted.render(" → " + st.remote);
      let cursor = "  ";
      if (i === this.sel) {
        cursor = t.title.render("▸ ");
        name = t.bold.render(name);
      }
      const line = `${cursor}${style.render(icon)} ${name}  ${t.muted.render(st.mode + " · " + orDash(st.watcher))}${t.muted.render(branch)}  ` +
        `+${st.added} ~${st.updated} -${st.deleted} ↻${st.renamed}  ${t.muted.render("last " + last)}  ${style.render(state)}`;
      return truncate(line, w - 4);
    });
    return box(lines, w, t.border);
  }

  private filesView(w: number, h: number): string[] {
    const t = theme();
    const st = this.statuses[this.sel]!;
    const inner = h - 2;
    const lines: string[] = [];
    let head = t.bold.render("Changed this session") + t.muted.render(`  (${this.rows.filter((r) => r.path !== "").length})`);
    if (this.filter !== "") head += t.flash.render("  /" + this.filter) + t.muted.render(" esc clears");
    lines.push(head);

    const gitLines = st.isGit ? Math.min(st.gitStatus.length, 6) + 2 : 0;
    const listH = Math.max(3, inner - 1 - gitLines);
    if (this.rows.length === 0) {
      lines.push(t.muted.render(this.filter !== "" ? "  no files match the filter" : "  nothing yet — edit a file in the source"));
    }
    const start = this.fileSel >= listH ? this.fileSel - listH + 1 : 0;
    for (let i = start; i < this.rows.length && i < start + listH; i++) {
      const r = this.rows[i]!;
      const indent = "  ".repeat(r.depth);
      let line: string;
      if (r.path === "") line = t.muted.render(indent + r.text);
      else {
        const [sym, style] = kindStyle(r.kind);
        const label = r.conflict ? r.path + "  (s/t/n/b/m to resolve)" : r.text;
        line = indent + style.render(sym) + " " + label;
        if (r.dir) line += t.muted.render(" " + r.dir);
        if (i === this.fileSel) line = t.sel.render(truncate(indent + sym + " " + label, w - 6));
      }
      lines.push(truncate(line, w - 4));
    }
    while (lines.length < listH + 1) lines.push("");
    if (st.isGit) {
      lines.push("");
      const staged = gitx.stagedCount(st.gitStatus);
      let g = `git ⎇ ${orDash(st.branch)} · ${st.gitStatus.length} uncommitted`;
      if (staged > 0) g += ` · ${staged} staged`;
      if (st.gitStatus.length === 0) g = `git ⎇ ${orDash(st.branch)} · clean`;
      lines.push(t.bold.render(g) + t.muted.render("  a stage · c commit · C commit+push"));
      for (const l of st.gitStatus.slice(0, 6)) lines.push(truncate(t.muted.render("  " + l), w - 4));
    }
    return box(lines.slice(0, inner), w, t.borderActive, inner);
  }

  private logView(w: number, h: number): string[] {
    const t = theme();
    const inner = h - 2;
    let title = t.bold.render("Activity");
    if (this.logOff > 0) title += t.muted.render(`  (scrolled ↑${this.logOff} · End to follow)`);
    const shown = this.logs.filter((ev) => matches(this.filter, ev.path, ev.to, ev.msg));
    const avail = inner - 1;
    const end = Math.max(0, shown.length - this.logOff);
    const start = Math.max(0, end - avail);
    const multi = this.engines.length > 1;
    const lines = [title];
    for (const ev of shown.slice(start, end)) {
      const [sym, style] = kindStyle(ev.kind);
      let b = t.muted.render(fmtClock(new Date(ev.time))) + " ";
      if (multi) b += t.muted.render(`[${ev.pair}] `);
      b += style.render(sym) + " ";
      if (ev.dir) b += t.muted.render(ev.dir) + " ";
      if (ev.path) {
        b += ev.path;
        if (ev.to) b += " → " + ev.to;
        if (ev.msg) b += " " + t.muted.render(ev.msg);
      } else b += style.render(ev.msg ?? "");
      if (ev.dryRun) b += t.muted.render(" (dry-run)");
      lines.push(truncate(b, w - 4));
    }
    return box(lines, w, t.border, inner);
  }

  private footerView(w: number): string {
    const t = theme();
    if (this.mode === "commit") {
      let label = this.staged ? "commit staged" : "commit";
      if (this.push) label += " + push";
      return t.title.render(` ${label}: `) + this.input.view(t.muted) + t.muted.render("  enter ok · esc cancel");
    }
    if (this.mode === "search") return t.title.render(" / ") + this.search.view(t.muted) + t.muted.render("  enter keep · esc clear");
    if (this.flashing()) return " " + t.flash.render(this.flash);
    const keys = ["tab pair", "↑↓ file", "/ filter", "d diff", "e edit", "i ignore", "a stage", "c commit", "p pause", "r resync", "H history", "s/t/n/b/m resolve", "? help"];
    return truncate(t.muted.render(" " + keys.join(" · ")), w);
  }

  private renderHistory(): string {
    const t = theme();
    if (this.batches.length === 0) return t.muted.render("no sync batches recorded yet");
    const out: string[] = [];
    let newestLive = true;
    for (let i = 0; i < this.batches.length; i++) {
      if (i === 100) {
        out.push(t.muted.render(`… ${this.batches.length - 100} older batches (see: ferry history)`));
        break;
      }
      const bt = this.batches[i]!;
      const c = counts(bt);
      let line = `${fmtDateTime(new Date(bt.time))}  +${c.add} ~${c.update} -${c.del} ↻${c.rename}`;
      if (bt.undone) line = t.muted.render(line + "  (undone)");
      else if (newestLive) line = t.bold.render(line) + t.flash.render("  ← u undoes this");
      if (!bt.undone) newestLive = false;
      out.push(line);
      bt.entries.slice(0, 6).forEach((en) => {
        const [sym, style] = opStyle(en.op);
        out.push("    " + style.render(sym) + " " + en.path + (en.to ? " → " + en.to : "") + t.muted.render(` (${en.side})`));
      });
      if (bt.entries.length > 6) out.push(t.muted.render(`      … ${bt.entries.length - 6} more`));
    }
    return out.join("\n");
  }
}
