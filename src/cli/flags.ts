// Command-line flags with Go's flag-package syntax: -name or --name,
// -name=value or -name value, booleans as -name or -name=false. Flags may
// appear before or after positional arguments; "--" ends them.
import { formatDuration, parseDuration } from "../util.ts";

type Kind = "string" | "bool" | "int" | "duration" | "multi";

interface Flag {
  name: string;
  kind: Kind;
  usage: string;
  def: string | boolean | number | string[];
  value: string | boolean | number | string[];
}

export class HelpRequested extends Error {
  constructor() {
    super("help requested");
  }
}

export class FlagError extends Error {}

export class FlagSet {
  private flags = new Map<string, Flag>();
  private visited = new Set<string>();
  usage: () => void = () => this.printDefaults();

  constructor(public name: string) {}

  private define(name: string, kind: Kind, def: Flag["def"], usage: string): void {
    this.flags.set(name, { name, kind, usage, def, value: Array.isArray(def) ? [...def] : def });
  }

  string(name: string, def: string, usage: string): this {
    this.define(name, "string", def, usage);
    return this;
  }
  bool(name: string, def: boolean, usage: string): this {
    this.define(name, "bool", def, usage);
    return this;
  }
  int(name: string, def: number, usage: string): this {
    this.define(name, "int", def, usage);
    return this;
  }
  /** A duration in milliseconds. */
  duration(name: string, def: number, usage: string): this {
    this.define(name, "duration", def, usage);
    return this;
  }
  /** A repeatable string flag. */
  multi(name: string, usage: string): this {
    this.define(name, "multi", [], usage);
    return this;
  }

  getString(name: string): string {
    return this.get(name) as string;
  }
  getBool(name: string): boolean {
    return this.get(name) as boolean;
  }
  getInt(name: string): number {
    return this.get(name) as number;
  }
  getDuration(name: string): number {
    return this.get(name) as number;
  }
  getMulti(name: string): string[] {
    return this.get(name) as string[];
  }

  private get(name: string): Flag["value"] {
    const f = this.flags.get(name);
    if (!f) throw new Error(`flag ${name} is not defined`);
    return f.value;
  }

  /** Whether the flag was given on the command line. */
  wasSet(name: string): boolean {
    return this.visited.has(name);
  }

  /** Names of the flags given on the command line, in definition order. */
  setFlags(): string[] {
    return [...this.flags.keys()].filter((n) => this.visited.has(n));
  }

  names(): string[] {
    return [...this.flags.keys()];
  }

  private fail(msg: string): never {
    process.stderr.write(msg + "\n");
    this.usage();
    throw new FlagError(msg);
  }

  /** Parses args and returns the positional arguments. Throws HelpRequested or FlagError. */
  parse(args: string[]): string[] {
    const pos: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      if (a === "--") {
        pos.push(...args.slice(i + 1));
        break;
      }
      if (a.length < 2 || a[0] !== "-") {
        pos.push(a);
        continue;
      }
      let name = a.slice(a[1] === "-" ? 2 : 1);
      if (name === "" || name[0] === "-" || name[0] === "=") this.fail(`bad flag syntax: ${a}`);
      let value: string | undefined;
      const eq = name.indexOf("=");
      if (eq >= 0) {
        value = name.slice(eq + 1);
        name = name.slice(0, eq);
      }
      const f = this.flags.get(name);
      if (!f) {
        if (name === "help" || name === "h") {
          this.usage();
          throw new HelpRequested();
        }
        this.fail(`flag provided but not defined: -${name}`);
      }
      if (f.kind === "bool") {
        if (value === undefined) f.value = true;
        else if (/^(1|t|true|T|TRUE|True)$/.test(value)) f.value = true;
        else if (/^(0|f|false|F|FALSE|False)$/.test(value)) f.value = false;
        else this.fail(`invalid boolean value "${value}" for -${name}`);
        this.visited.add(name);
        continue;
      }
      if (value === undefined) {
        if (i + 1 >= args.length) this.fail(`flag needs an argument: -${name}`);
        value = args[++i]!;
      }
      switch (f.kind) {
        case "string":
          f.value = value;
          break;
        case "multi":
          (f.value as string[]).push(value);
          break;
        case "int": {
          const n = Number(value);
          if (!Number.isInteger(n)) this.fail(`invalid value "${value}" for flag -${name}: parse error`);
          f.value = n;
          break;
        }
        case "duration":
          try {
            f.value = parseDuration(value);
          } catch {
            this.fail(`invalid value "${value}" for flag -${name}: parse error`);
          }
          break;
      }
      this.visited.add(name);
    }
    return pos;
  }

  /** Prints every flag with its default, like Go's PrintDefaults. */
  printDefaults(): void {
    let out = "";
    for (const f of [...this.flags.values()].sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const type = { string: " string", bool: "", int: " int", duration: " duration", multi: " value" }[f.kind];
      out += `  -${f.name}${type}\n    \t${f.usage}`;
      const d = f.def;
      if (f.kind === "string" && d !== "") out += ` (default ${JSON.stringify(d)})`;
      else if (f.kind === "int" && d !== 0) out += ` (default ${d})`;
      else if (f.kind === "duration" && d !== 0) out += ` (default ${formatDuration(d as number)})`;
      out += "\n";
    }
    process.stderr.write(out);
  }
}
