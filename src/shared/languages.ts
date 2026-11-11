// Which language a file is written in, and how much of a repository each
// language makes up, the way GitHub's language bar counts it: bytes of
// programming and markup languages only (no data or prose like JSON, YAML or
// Markdown), leaving out vendored, generated and documentation folders.
// Names and colours follow GitHub Linguist. No imports: the server and the web
// app both use this.

export interface Language {
  name: string;
  color: string;
}

const L = (name: string, color: string): Language => ({ name, color });

const TS = L("TypeScript", "#3178c6");
const JS = L("JavaScript", "#f1e05a");
const CPP = L("C++", "#f34b7d");
const SHELL = L("Shell", "#89e051");

/** By extension (lower case, without the dot). */
const BY_EXT: Record<string, Language> = {
  ts: TS,
  mts: TS,
  cts: TS,
  tsx: L("TSX", "#3178c6"),
  js: JS,
  mjs: JS,
  cjs: JS,
  jsx: JS,
  py: L("Python", "#3572a5"),
  pyw: L("Python", "#3572a5"),
  ipynb: L("Jupyter Notebook", "#da5b0b"),
  rs: L("Rust", "#dea584"),
  go: L("Go", "#00add8"),
  java: L("Java", "#b07219"),
  kt: L("Kotlin", "#a97bff"),
  kts: L("Kotlin", "#a97bff"),
  scala: L("Scala", "#c22d40"),
  groovy: L("Groovy", "#4298b8"),
  cs: L("C#", "#178600"),
  fs: L("F#", "#b845fc"),
  vb: L("Visual Basic .NET", "#945db7"),
  c: L("C", "#555555"),
  h: L("C", "#555555"),
  cpp: CPP,
  cc: CPP,
  cxx: CPP,
  hpp: CPP,
  hh: CPP,
  m: L("Objective-C", "#438eff"),
  mm: L("Objective-C++", "#6866fb"),
  swift: L("Swift", "#f05138"),
  dart: L("Dart", "#00b4ab"),
  rb: L("Ruby", "#701516"),
  php: L("PHP", "#4f5d95"),
  pl: L("Perl", "#0298c3"),
  lua: L("Lua", "#000080"),
  r: L("R", "#198ce7"),
  jl: L("Julia", "#a270ba"),
  ex: L("Elixir", "#6e4a7e"),
  exs: L("Elixir", "#6e4a7e"),
  erl: L("Erlang", "#b83998"),
  hs: L("Haskell", "#5e5086"),
  ml: L("OCaml", "#ef7a08"),
  clj: L("Clojure", "#db5855"),
  cljs: L("Clojure", "#db5855"),
  elm: L("Elm", "#60b5cc"),
  zig: L("Zig", "#ec915c"),
  nim: L("Nim", "#ffc200"),
  cr: L("Crystal", "#000100"),
  sol: L("Solidity", "#aa6746"),
  asm: L("Assembly", "#6e4c13"),
  s: L("Assembly", "#6e4c13"),
  sh: SHELL,
  bash: SHELL,
  zsh: SHELL,
  fish: L("fish", "#4aae47"),
  ps1: L("PowerShell", "#012456"),
  psm1: L("PowerShell", "#012456"),
  bat: L("Batchfile", "#c1f12e"),
  cmd: L("Batchfile", "#c1f12e"),
  vim: L("Vim Script", "#199f4b"),
  tf: L("HCL", "#844fba"),
  hcl: L("HCL", "#844fba"),
  nix: L("Nix", "#7e7eff"),
  // markup and styles
  html: L("HTML", "#e34c26"),
  htm: L("HTML", "#e34c26"),
  css: L("CSS", "#563d7c"),
  scss: L("SCSS", "#c6538c"),
  sass: L("Sass", "#a53b70"),
  less: L("Less", "#1d365d"),
  styl: L("Stylus", "#ff6347"),
  svelte: L("Svelte", "#ff3e00"),
  vue: L("Vue", "#41b883"),
  astro: L("Astro", "#ff5a03"),
  hbs: L("Handlebars", "#f7931e"),
  pug: L("Pug", "#a86454"),
};

/** By exact file name (case-insensitive). */
const BY_NAME: Record<string, Language> = {
  dockerfile: L("Dockerfile", "#384d54"),
  makefile: L("Makefile", "#427819"),
  gnumakefile: L("Makefile", "#427819"),
  "cmakelists.txt": L("CMake", "#da3434"),
  justfile: L("Just", "#384d54"),
};

/** Folders and files GitHub leaves out of the bar: dependencies, build output, generated and documentation files. */
const SKIP = [
  /(^|\/)(node_modules|vendor|vendors|third[_-]?party|bower_components|dist|build|out|target|coverage|\.next|\.nuxt|\.svelte-kit|__pycache__)\//i,
  /(^|\/)docs?\//i,
  /\.min\.(js|css)$/i,
  /\.(map|lock)$/i,
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|go\.sum)$/i,
];

/** The language of a file at this path, or null when it isn't counted (data, prose, images, vendored code). */
export function languageOf(path: string): Language | null {
  if (SKIP.some((re) => re.test(path))) return null;
  const name = path.split("/").pop()!.toLowerCase();
  if (BY_NAME[name]) return BY_NAME[name];
  if (name.startsWith("dockerfile.")) return BY_NAME.dockerfile!;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? (BY_EXT[name.slice(dot + 1)] ?? null) : null;
}

export interface LanguageShare {
  name: string;
  color: string;
  bytes: number;
  /** how many files */
  files: number;
  /** of all counted bytes, 0–1 */
  share: number;
}

/**
 * Bytes per language, largest first. Languages under 0.5% are summed into
 * "Other" once there are more than `max` of them, so the bar stays readable.
 */
export function languageShares(files: { path: string; size: number }[], max = 8): LanguageShare[] {
  const by = new Map<string, { color: string; bytes: number; files: number }>();
  for (const f of files) {
    const l = languageOf(f.path);
    if (!l || !(f.size > 0)) continue;
    const cur = by.get(l.name);
    if (cur) {
      cur.bytes += f.size;
      cur.files++;
    } else by.set(l.name, { color: l.color, bytes: f.size, files: 1 });
  }
  const total = [...by.values()].reduce((n, v) => n + v.bytes, 0);
  if (!total) return [];
  const all = [...by]
    .map(([name, v]) => ({ name, color: v.color, bytes: v.bytes, files: v.files, share: v.bytes / total }))
    .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
  if (all.length <= max) return all;
  const keep = all.slice(0, max - 1).filter((l) => l.share >= 0.005);
  const rest = all.slice(keep.length);
  const bytes = rest.reduce((n, l) => n + l.bytes, 0);
  const count = rest.reduce((n, l) => n + l.files, 0);
  return [...keep, { name: "Other", color: "#8b949e", bytes, files: count, share: bytes / total }];
}
