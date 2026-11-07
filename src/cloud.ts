// Cloud object storage targets, written "s3://bucket/optional/prefix".
//
// Any S3-compatible service works: AWS S3, Cloudflare R2, MinIO, Backblaze B2,
// Google Cloud Storage (interoperability mode). Credentials come from the
// environment the way Bun's S3 client reads them: S3_ACCESS_KEY_ID /
// AWS_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY / AWS_SECRET_ACCESS_KEY,
// S3_REGION / AWS_REGION, and S3_ENDPOINT / AWS_ENDPOINT for non-AWS services.
//
// Like ssh targets, a cloud pair syncs into a local shadow folder and the
// changed files are then uploaded (and deletions applied) after each pass.

/** Whether s names a cloud target. */
export function isSpec(s: string): boolean {
  return /^s3:\/\/[^/]+/i.test(s);
}

export class Spec {
  constructor(
    public bucket: string,
    public prefix: string, // "" or "some/folder" (no leading or trailing slash)
  ) {}

  toString(): string {
    return "s3://" + this.bucket + (this.prefix ? "/" + this.prefix : "");
  }

  /** The object key for a pair-relative slash path. */
  key(rel: string): string {
    return this.prefix ? this.prefix + "/" + rel : rel;
  }
}

export function parse(s: string): Spec {
  const m = /^s3:\/\/([^/]+)(?:\/(.*))?$/i.exec(s.trim());
  if (!m) throw new Error(`"${s}" is not a cloud target (expected s3://bucket/prefix)`);
  const bucket = m[1]!;
  if (!/^[a-z0-9][a-z0-9.\-_]{1,254}$/i.test(bucket)) throw new Error(`"${bucket}" is not a valid bucket name`);
  const prefix = (m[2] ?? "").replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/");
  if (prefix.split("/").includes("..")) throw new Error(`cloud prefix "${prefix}" can't contain ..`);
  return new Spec(bucket, prefix);
}

/** What ferry needs from a bucket. */
export interface Store {
  /** Uploads a local file to key. */
  put(key: string, file: string): Promise<void>;
  /** Deletes key; a missing key is not an error. */
  del(key: string): Promise<void>;
  /** Checks that the bucket can be reached with the current credentials. */
  check(): Promise<void>;
}

class S3Store implements Store {
  private client: Bun.S3Client;

  constructor(private spec: Spec) {
    this.client = new Bun.S3Client({ bucket: spec.bucket });
  }

  async put(key: string, file: string): Promise<void> {
    const f = Bun.file(file);
    await this.client.write(key, f, { type: f.type || "application/octet-stream" });
  }

  async del(key: string): Promise<void> {
    await this.client.delete(key);
  }

  async check(): Promise<void> {
    await this.client.list({ prefix: this.spec.prefix, maxKeys: 1 });
  }
}

/** Opens a bucket. Tests replace this to avoid the network. */
export let open = (spec: Spec): Store => new S3Store(spec);

export function setOpener(f: (spec: Spec) => Store): void {
  open = f;
}

/** Whether S3 credentials are set in the environment. */
export function hasCredentials(): boolean {
  const env = process.env;
  return !!((env.S3_ACCESS_KEY_ID || env.AWS_ACCESS_KEY_ID) && (env.S3_SECRET_ACCESS_KEY || env.AWS_SECRET_ACCESS_KEY));
}

/** Runs f over items with at most n running at once; the first failure is thrown after all settle. */
export async function eachLimit<T>(items: T[], n: number, f: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  let first: unknown = null;
  const worker = async () => {
    while (i < items.length) {
      const x = items[i++]!;
      try {
        await f(x);
      } catch (e) {
        first ??= e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  if (first) throw first;
}
