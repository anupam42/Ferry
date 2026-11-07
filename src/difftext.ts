// A unified-style line diff without external tools.

/** One rendered diff line. op is " ", "+", "-" or "@" (hunk header / note). */
export interface Line {
  op: " " | "+" | "-" | "@";
  text: string;
}

const MAX_CELLS = 25_000_000; // guard against huge LCS tables

/** Whether data looks binary (NUL byte in the first 8KB). */
export function isBinary(data: Uint8Array): boolean {
  const n = Math.min(data.length, 8000);
  for (let i = 0; i < n; i++) if (data[i] === 0) return true;
  return false;
}

function split(b: Uint8Array): string[] {
  let s = Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString("utf8").replaceAll("\r\n", "\n");
  if (s.endsWith("\n")) s = s.slice(0, -1);
  return s === "" ? [] : s.split("\n");
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(b);
}

/** Unified diff lines with `context` lines around changes. */
export function diff(a: Uint8Array, b: Uint8Array, context: number): Line[] {
  if (isBinary(a) || isBinary(b)) {
    if (bytesEqual(a, b)) return [];
    return [{ op: "@", text: `binary files differ (${a.length} → ${b.length} bytes)` }];
  }
  const al = split(a), bl = split(b);

  // trim the common prefix/suffix to keep the table small
  let pre = 0;
  while (pre < al.length && pre < bl.length && al[pre] === bl[pre]) pre++;
  let suf = 0;
  while (suf < al.length - pre && suf < bl.length - pre && al[al.length - 1 - suf] === bl[bl.length - 1 - suf]) suf++;
  const am = al.slice(pre, al.length - suf), bm = bl.slice(pre, bl.length - suf);
  if (am.length * bm.length > MAX_CELLS) {
    return [{ op: "@", text: `diff too large to display (${am.length} vs ${bm.length} changed lines)` }];
  }

  const n = am.length, m = bm.length, W = m + 1;
  const dp = new Int32Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (am[i] === bm[j]) dp[i * W + j] = dp[(i + 1) * W + j + 1]! + 1;
      else dp[i * W + j] = Math.max(dp[(i + 1) * W + j]!, dp[i * W + j + 1]!);
    }
  }

  interface Op { k: Line["op"]; s: string; ai: number; bi: number } // 1-based line numbers
  const ops: Op[] = [];
  for (let i = 0; i < pre; i++) ops.push({ k: " ", s: al[i]!, ai: i + 1, bi: i + 1 });
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && am[i] === bm[j]) {
      ops.push({ k: " ", s: am[i]!, ai: pre + i + 1, bi: pre + j + 1 });
      i++;
      j++;
    } else if (j < m && (i === n || dp[i * W + j + 1]! >= dp[(i + 1) * W + j]!)) {
      ops.push({ k: "+", s: bm[j]!, ai: pre + i + 1, bi: pre + j + 1 });
      j++;
    } else {
      ops.push({ k: "-", s: am[i]!, ai: pre + i + 1, bi: pre + j + 1 });
      i++;
    }
  }
  for (let k = 0; k < suf; k++) {
    ops.push({ k: " ", s: al[al.length - suf + k]!, ai: al.length - suf + k + 1, bi: bl.length - suf + k + 1 });
  }

  // group into hunks
  const out: Line[] = [];
  for (let k = 0; k < ops.length; ) {
    if (ops[k]!.k === " ") {
      k++;
      continue;
    }
    const start = Math.max(0, k - context);
    let end = k;
    while (end < ops.length) {
      if (ops[end]!.k !== " ") {
        end++;
        continue;
      }
      // a short run of context between changes stays in the hunk
      let run = end;
      while (run < ops.length && ops[run]!.k === " ") run++;
      if (run < ops.length && run - end <= 2 * context) {
        end = run;
        continue;
      }
      end = Math.min(end + context, ops.length);
      break;
    }
    let aCount = 0, bCount = 0;
    for (const o of ops.slice(start, end)) {
      if (o.k !== "+") aCount++;
      if (o.k !== "-") bCount++;
    }
    out.push({ op: "@", text: `@@ -${ops[start]!.ai},${aCount} +${ops[start]!.bi},${bCount} @@` });
    for (const o of ops.slice(start, end)) out.push({ op: o.k, text: o.s });
    k = end;
  }
  return out;
}

/** Renders diff lines as unified-diff text. */
export function diffText(lines: Line[]): string {
  return lines.map((l) => (l.op === "@" ? l.text : l.op + l.text) + "\n").join("");
}
