// Line-based three-way merges (diff3) without external tools.
//
// Files are handled as latin1 strings so every byte survives unchanged, no
// matter the encoding.

export interface Labels {
  ours: string;
  theirs: string;
}

export class TooLargeError extends Error {
  constructor() {
    super("merge: too many changed lines");
  }
}

const MAX_CELLS = 4_000_000;

/**
 * Applies both the base→ours and base→theirs changes to base. Changes that
 * overlap (or touch adjacent lines, as in git) become conflict blocks with
 * <<<<<<< ======= >>>>>>> markers; their number is returned.
 */
export function merge3(
  base: Uint8Array,
  ours: Uint8Array,
  theirs: Uint8Array,
  l: Labels,
): { data: Buffer; conflicts: number } {
  const B = splitLines(base),
    O = splitLines(ours),
    T = splitLines(theirs);
  const mo = match(B, O);
  const mt = match(B, T);
  const out: string[] = [];
  let conflicts = 0;
  let i = 0,
    jo = 0,
    jt = 0;
  for (;;) {
    // next base line that survived unchanged on both sides
    let k = i;
    while (k < B.length && (mo[k]! < 0 || mt[k]! < 0)) k++;
    let eo = O.length,
      et = T.length;
    if (k < B.length) {
      eo = mo[k]!;
      et = mt[k]!;
    }
    const bc = B.slice(i, k),
      oc = O.slice(jo, eo),
      tc = T.slice(jt, et);
    if (equal(oc, tc)) out.push(...oc);
    else if (equal(bc, oc)) out.push(...tc);
    else if (equal(bc, tc)) out.push(...oc);
    else {
      conflicts++;
      out.push("<<<<<<< " + l.ours + "\n");
      writeBlock(out, oc);
      out.push("=======\n");
      writeBlock(out, tc);
      out.push(">>>>>>> " + l.theirs + "\n");
    }
    if (k >= B.length) break;
    out.push(B[k]!);
    i = k + 1;
    jo = eo + 1;
    jt = et + 1;
  }
  return { data: Buffer.from(out.join(""), "latin1"), conflicts };
}

function splitLines(b: Uint8Array): string[] {
  const s = Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString("latin1");
  const out: string[] = [];
  let start = 0;
  while (start < s.length) {
    const i = s.indexOf("\n", start);
    if (i < 0) {
      out.push(s.slice(start));
      break;
    }
    out.push(s.slice(start, i + 1));
    start = i + 1;
  }
  return out;
}

function equal(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Writes lines and makes sure the block ends with a newline so the next marker starts on its own line. */
function writeBlock(out: string[], lines: string[]): void {
  out.push(...lines);
  const last = lines[lines.length - 1];
  if (last !== undefined && last.length > 0 && !last.endsWith("\n")) out.push("\n");
}

/** For each line of a, the index of the line of b it pairs with in a longest common subsequence, or -1. */
function match(a: string[], b: string[]): Int32Array {
  const res = new Int32Array(a.length).fill(-1);
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) {
    res[pre] = pre;
    pre++;
  }
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) {
    res[a.length - 1 - suf] = b.length - 1 - suf;
    suf++;
  }
  const am = a.slice(pre, a.length - suf),
    bm = b.slice(pre, b.length - suf);
  const n = am.length,
    m = bm.length;
  if (n === 0 || m === 0) return res;
  if (n * m > MAX_CELLS) throw new TooLargeError();
  const W = m + 1;
  const dp = new Int32Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (am[i] === bm[j]) dp[i * W + j] = dp[(i + 1) * W + j + 1]! + 1;
      else dp[i * W + j] = Math.max(dp[(i + 1) * W + j]!, dp[i * W + j + 1]!);
    }
  }
  let i = 0,
    j = 0;
  while (i < n && j < m) {
    if (am[i] === bm[j]) {
      res[pre + i] = pre + j;
      i++;
      j++;
    } else if (dp[(i + 1) * W + j]! >= dp[i * W + j + 1]!) i++;
    else j++;
  }
  return res;
}
