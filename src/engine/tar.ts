// A minimal tar writer (ustar, with PAX records for long or non-ASCII names),
// enough to stream changed files to an ssh target.
import fs from "node:fs";

const BLOCK = 512;

export interface TarEntry {
  name: string; // slash path inside the archive
  mode: number; // permission bits
  mtimeSec: number;
  size: number;
  link?: string; // symlink target (no content)
  file?: string; // path of the content on disk
}

function octal(n: number, width: number): string {
  return n.toString(8).padStart(width - 1, "0") + "\0";
}

function header(name: string, mode: number, size: number, mtime: number, type: string, link = ""): Buffer {
  const h = Buffer.alloc(BLOCK);
  h.write(name, 0, 100, "utf8");
  h.write(octal(mode & 0o7777, 8), 100, "ascii");
  h.write(octal(0, 8), 108, "ascii"); // uid
  h.write(octal(0, 8), 116, "ascii"); // gid
  h.write(octal(size, 12), 124, "ascii");
  h.write(octal(Math.max(0, Math.floor(mtime)), 12), 136, "ascii");
  h.write("        ", 148, "ascii"); // checksum placeholder
  h.write(type, 156, "ascii");
  h.write(link, 157, 100, "utf8");
  h.write("ustar\0", 257, "ascii");
  h.write("00", 263, "ascii");
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  return h;
}

function paxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`;
  let len = Buffer.byteLength(body) + 1;
  while (String(len).length + Buffer.byteLength(body) !== len) len = String(len).length + Buffer.byteLength(body);
  return len + body;
}

const fitsUstar = (s: string) => /^[\x20-\x7e]*$/.test(s) && Buffer.byteLength(s) <= 100;

export class TarWriter {
  private fd: number;

  constructor(file: string) {
    this.fd = fs.openSync(file, "w");
  }

  private write(b: Uint8Array): void {
    let off = 0;
    while (off < b.length) off += fs.writeSync(this.fd, b, off, b.length - off);
  }

  private pad(size: number): void {
    const rem = size % BLOCK;
    if (rem) this.write(Buffer.alloc(BLOCK - rem));
  }

  add(e: TarEntry): void {
    const link = e.link ?? "";
    const size = e.link !== undefined ? 0 : e.size;
    let pax = "";
    if (!fitsUstar(e.name)) pax += paxRecord("path", e.name);
    if (link && !fitsUstar(link)) pax += paxRecord("linkpath", link);
    if (pax) {
      const body = Buffer.from(pax, "utf8");
      this.write(
        header("PaxHeaders/" + e.name.slice(-80).replace(/[^\x20-\x7e]/g, "_"), 0o644, body.length, e.mtimeSec, "x"),
      );
      this.write(body);
      this.pad(body.length);
    }
    const asciiName = fitsUstar(e.name) ? e.name : e.name.replace(/[^\x20-\x7e]/g, "_").slice(-100);
    const asciiLink = fitsUstar(link) ? link : link.replace(/[^\x20-\x7e]/g, "_").slice(-100);
    this.write(header(asciiName, e.mode, size, e.mtimeSec, e.link !== undefined ? "2" : "0", asciiLink));
    if (e.link === undefined && e.file) {
      const fd = fs.openSync(e.file, "r");
      try {
        const buf = Buffer.allocUnsafe(1 << 20);
        let written = 0;
        while (written < size) {
          const n = fs.readSync(fd, buf, 0, Math.min(buf.length, size - written), null);
          if (n <= 0) break;
          this.write(buf.subarray(0, n));
          written += n;
        }
        // the file shrank while we read it: keep the archive well-formed
        if (written < size) this.write(Buffer.alloc(size - written));
      } finally {
        fs.closeSync(fd);
      }
      this.pad(size);
    }
  }

  close(): void {
    this.write(Buffer.alloc(BLOCK * 2));
    fs.closeSync(this.fd);
  }
}
