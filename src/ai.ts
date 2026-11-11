// Commit messages written by Claude, for the {ai} placeholder in commit
// message templates. Needs ANTHROPIC_API_KEY (or an `ant auth login` profile);
// without credentials, or if the request fails, callers fall back to the
// built-in {summary}.
import Anthropic from "@anthropic-ai/sdk";

import { errMsg } from "./util.ts";

export const AI_MODEL = process.env.FERRY_AI_MODEL || "claude-opus-5-5";
const DIFF_MAX = 60_000; // characters of diff sent; the rest is summarised by the file list

const SYSTEM = `You write git commit messages. Reply with the message only: no quotes, no code fences, no preamble.
Write a subject line in the imperative mood, at most 72 characters, describing what the change does and why if that is evident.
If the change has several distinct parts, add a blank line and up to 4 short "- " bullet points. Do not invent details the diff doesn't show.`;

let client: Anthropic | null = null;

/** Whether credentials for the Claude API look available. */
export function aiConfigured(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE);
}

/**
 * Asks Claude for a commit message for the changes described by git status
 * lines and a diff. Throws on any failure (no credentials, network, refusal),
 * so the caller can fall back.
 */
export async function commitMessage(statusLines: string[], diff: string, timeoutMs = 60_000): Promise<string> {
  client ??= new Anthropic({ maxRetries: 1 });
  let d = diff;
  if (d.length > DIFF_MAX) d = d.slice(0, DIFF_MAX) + `\n… (diff truncated; ${diff.length - DIFF_MAX} more characters)`;
  const prompt =
    `Changed files (git status --porcelain):\n${statusLines.join("\n")}\n\n` +
    (d.trim() ? `Diff:\n${d}` : "No textual diff is available (new or binary files only).");
  const res = await client.beta.messages.create(
    {
      model: AI_MODEL,
      max_tokens: 4000,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    },
    { timeout: timeoutMs },
  );
  if (res.stop_reason === "refusal") throw new Error("the model declined to write a message");
  const text = res.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim()
    .replace(/^```[a-z]*\n?|\n?```$/g, "")
    .trim();
  if (text === "") throw new Error("empty reply");
  return text;
}

/** commitMessage, or null with the reason when it can't be used. */
export async function tryCommitMessage(
  statusLines: string[],
  diff: string,
): Promise<{ msg: string | null; error: string }> {
  // the SDK also finds `ant auth login` profiles, so try even without the env vars
  try {
    return { msg: await commitMessage(statusLines, diff), error: "" };
  } catch (e) {
    const why = errMsg(e);
    if (!aiConfigured() && /api.?key|auth|credential/i.test(why)) {
      return { msg: null, error: "no Claude API credentials (set ANTHROPIC_API_KEY or run `ant auth login`)" };
    }
    return { msg: null, error: why };
  }
}
