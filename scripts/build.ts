// Cross-compiles ferry into ./dist with `bun build --compile`.
//   bun scripts/build.ts                 every platform
//   bun scripts/build.ts --archive      also write the release archives + checksums.txt
//   bun scripts/build.ts linux-x64      just one target
// VERSION (default: package.json version) and COMMIT come from the environment.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dir, "..");
process.chdir(root);

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const version = (process.env.VERSION ?? pkg.version).replace(/^v/, "");
const commit = process.env.COMMIT ?? "dev";
const date = new Date().toISOString();

// [bun target, os, arch] — os/arch names match the archives the install scripts download
const targets: [string, string, string][] = [
  ["bun-windows-x64", "windows", "amd64"],
  ["bun-windows-arm64", "windows", "arm64"],
  ["bun-darwin-x64", "darwin", "amd64"],
  ["bun-darwin-arm64", "darwin", "arm64"],
  ["bun-linux-x64", "linux", "amd64"],
  ["bun-linux-arm64", "linux", "arm64"],
];

const args = process.argv.slice(2);
const archive = args.includes("--archive");
const only = args.filter((a) => !a.startsWith("--"));
const chosen = only.length ? targets.filter(([t, os, arch]) => only.some((o) => t === o || t === "bun-" + o || `${os}-${arch}` === o)) : targets;
if (chosen.length === 0) throw new Error(`unknown target ${only.join(" ")}; use e.g. linux-x64 or windows-amd64`);

fs.mkdirSync("dist", { recursive: true });
const sums: string[] = [];

async function run(cmd: string[], cwd = root): Promise<void> {
  const p = Bun.spawn({ cmd, cwd, stdout: "inherit", stderr: "inherit" });
  if ((await p.exited) !== 0) throw new Error(`failed: ${cmd.join(" ")}`);
}

for (const [target, os, arch] of chosen) {
  const ext = os === "windows" ? ".exe" : "";
  const out = path.join("dist", `ferry-${os}-${arch}${ext}`);
  const cmd = [
    process.execPath, "build", "src/main.ts", "--compile", "--minify", `--target=${target}`, "--outfile", out,
    "--define", `FERRY_VERSION=${JSON.stringify(version)}`,
    "--define", `FERRY_COMMIT=${JSON.stringify(commit)}`,
    "--define", `FERRY_DATE=${JSON.stringify(date)}`,
  ];
  await run(cmd);
  console.log(`built ${out}`);

  if (!archive) continue;
  // ferry_<version>_<os>_<arch>.tar.gz / .zip containing ferry[.exe] + docs
  const name = `ferry_${version}_${os}_${arch}`;
  const stage = path.join("dist", name);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage);
  fs.copyFileSync(out, path.join(stage, "ferry" + ext));
  for (const f of ["README.md", "LICENSE", "ferry.example.yaml"]) fs.copyFileSync(f, path.join(stage, f));
  const file = os === "windows" ? `${name}.zip` : `${name}.tar.gz`;
  fs.rmSync(path.join("dist", file), { force: true });
  if (os === "windows") await run(["zip", "-q", "-j", file, ...fs.readdirSync(stage).map((f) => path.join(name, f))], "dist");
  else await run(["tar", "-czf", file, "-C", name, "."], "dist");
  fs.rmSync(stage, { recursive: true, force: true });
  const hash = crypto.createHash("sha256").update(fs.readFileSync(path.join("dist", file))).digest("hex");
  sums.push(`${hash}  ${file}`);
  console.log(`packed dist/${file}`);
}

if (archive) {
  fs.writeFileSync(path.join("dist", "checksums.txt"), sums.join("\n") + "\n");
  console.log("wrote dist/checksums.txt");
}
