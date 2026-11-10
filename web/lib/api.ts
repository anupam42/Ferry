// Talking to the Ferry process that serves this page.

const params = new URLSearchParams(location.search);
if (params.get("token")) {
  // the link ferry printed carries the access token once; keep it for this tab only
  sessionStorage.setItem("ferry-token", params.get("token")!);
  history.replaceState(null, "", location.pathname);
}
export const token = sessionStorage.getItem("ferry-token") || "";
export const enc = encodeURIComponent;

export class ApiError extends Error {
  constructor(message: string, readonly code = "", readonly status = 0) {
    super(message);
  }
}

/** A JSON (or text) request; every request carries the X-Ferry header the server insists on. */
export async function api<T = unknown>(method: "GET" | "POST", url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "X-Ferry": "web" };
  if (token) headers.Authorization = "Bearer " + token;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) {
    let msg = text.trim() || res.statusText, code = "";
    try {
      const j = JSON.parse(text) as { error?: string; code?: string };
      msg = j.error || msg;
      code = j.code || "";
    } catch {}
    throw new ApiError(msg, code, res.status);
  }
  return ((res.headers.get("Content-Type") || "").includes("json") ? JSON.parse(text) : text) as T;
}

export const face = (mood: string) => `/mascot/${mood}.svg`;
