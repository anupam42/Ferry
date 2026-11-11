// The file-type icons (Material Icon Theme), loaded once from /icons.json the
// first time a page shows a file, so they don't add to app.js.

export type IconData = Record<string, { w: number; h: number; body: string }>;

export const fileIcons = $state<{ data: IconData | null }>({ data: null });

let asked = false;
/** Starts loading the icons (once; again after a failure). */
export function loadFileIcons(): void {
  if (asked) return;
  asked = true;
  fetch("/icons.json")
    .then((r) => (r.ok ? (r.json() as Promise<IconData>) : Promise.reject(new Error(r.statusText))))
    .then((d) => (fileIcons.data = d))
    .catch(() => (asked = false));
}
