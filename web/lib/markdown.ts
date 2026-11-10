// A small markdown parser for READMEs and pull-request comments (plain
// TypeScript, unit-tested). It produces a tree that a component renders with
// ordinary elements, so nothing in the text is ever parsed as HTML: raw HTML
// is reduced to its images (and their dark-mode variants) or its text.

export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "strong"; v: string }
  | { t: "em"; v: string }
  | { t: "img"; src: string; alt: string }
  | { t: "link"; href: string; kids: Inline[] };

export interface ImgRef { src: string; alt: string; width?: string }

export type Block =
  | { t: "p"; kids: Inline[] }
  | { t: "h"; level: number; kids: Inline[] }
  | { t: "pre"; v: string }
  | { t: "hr" }
  | { t: "quote"; kids: Block[] }
  | { t: "list"; ordered: boolean; items: { task: boolean | null; kids: Inline[] }[] }
  | { t: "img"; img: ImgRef }
  | { t: "picture"; sources: { srcset: string; media: string }[]; img: ImgRef };

const LIST = /^\s{0,3}(?:[-*+]|\d+[.)])\s+/;
const HTML_ONLY = /^\s*(?:<[^>]+>\s*)*$/;

export function parseMarkdown(text: string): Block[] {
  const out: Block[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ t: "p", kids: parseInline(para.join(" ")) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    let m: RegExpExecArray | null;
    if (/^```/.test(line)) {
      flush();
      const buf: string[] = [];
      for (i++; i < lines.length && !/^```\s*$/.test(lines[i]!); i++) buf.push(lines[i]!);
      out.push({ t: "pre", v: buf.join("\n") });
    } else if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
      flush();
      out.push({ t: "h", level: m[1]!.length, kids: parseInline(m[2]!.trim()) });
    } else if (/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flush();
      out.push({ t: "hr" });
    } else if (/^\s{0,3}>/.test(line)) {
      flush();
      const buf: string[] = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i]!)) buf.push(lines[i++]!.replace(/^\s{0,3}> ?/, ""));
      i--;
      out.push({ t: "quote", kids: parseMarkdown(buf.join("\n")) });
    } else if (LIST.test(line)) {
      flush();
      const ordered = /^\s{0,3}\d/.test(line);
      const items: { task: boolean | null; kids: Inline[] }[] = [];
      while (i < lines.length && LIST.test(lines[i]!)) {
        const it = lines[i++]!.replace(LIST, "");
        const task = /^\[( |x|X)\]\s+/.exec(it);
        items.push(task ? { task: task[1] !== " ", kids: parseInline(it.slice(task[0].length)) } : { task: null, kids: parseInline(it) });
      }
      i--;
      out.push({ t: "list", ordered, items });
    } else if (line.includes("<") && HTML_ONLY.test(line)) {
      // raw HTML blocks (badges, pictures): only their images are kept; a whole
      // <picture> keeps its <source> variants, so dark mode picks the right one
      flush();
      const buf = [line];
      while (i + 1 < lines.length && lines[i + 1]!.includes("<") && HTML_ONLY.test(lines[i + 1]!)) buf.push(lines[++i]!);
      const html = buf.join("\n");
      const img = (tag: string): ImgRef | null => {
        const src = /src="([^"]+)"/i.exec(tag)?.[1];
        return src ? { src, alt: /alt="([^"]*)"/i.exec(tag)?.[1] ?? "", width: /\swidth="(\d{1,4})"/i.exec(tag)?.[1] } : null;
      };
      for (const pm of html.matchAll(/<picture>([\s\S]*?)<\/picture>/gi)) {
        const sources = [...pm[1]!.matchAll(/<source\b[^>]*>/gi)].flatMap((sm) => {
          const srcset = /srcset="([^"]+)"/i.exec(sm[0])?.[1];
          return srcset ? [{ srcset, media: /media="([^"]*)"/i.exec(sm[0])?.[1] ?? "" }] : [];
        });
        const im = img(/<img\b[^>]*>/i.exec(pm[1]!)?.[0] ?? "");
        if (im) out.push({ t: "picture", sources, img: im });
      }
      for (const im of html.replace(/<picture>[\s\S]*?<\/picture>/gi, "").matchAll(/<img\b[^>]*>/gi)) {
        const r = img(im[0]);
        if (r) out.push({ t: "img", img: r });
      }
    } else if (/^\s{0,3}<[a-zA-Z!/]/.test(line) && />\s*$/.test(line)) {
      // HTML with text in it (<b>…</b>, <em>…</em>, <br>): keep the text, as markdown where trivial
      const txt = line.replace(/<\/?(b|strong)\s*>/gi, "**").replace(/<\/?(em|i)\s*>/gi, "*").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "");
      if (txt.trim()) para.push(txt.trim());
    } else if (!line.trim()) flush();
    else para.push(line.trim());
  }
  flush();
  return out;
}

/** Inline markdown: code, bold, italic, links and images (asterisks only, so snake_case stays alone). */
export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  const re = /`([^`]+)`|\*\*([^*\s](?:[^*\n]*[^*\s])?)\*\*|\*([^*\s](?:[^*\n]*[^*\s])?)\*|!\[([^\]]*)\]\(\s*([^)\s]+)[^)]*\)|\[([^\]]+)\]\(\s*([^)\s]+)[^)]*\)/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ t: "text", v: s.slice(last, m.index) });
    if (m[1] != null) out.push({ t: "code", v: m[1] });
    else if (m[2] != null) out.push({ t: "strong", v: m[2] });
    else if (m[3] != null) out.push({ t: "em", v: m[3] });
    else if (m[4] != null) out.push({ t: "img", src: m[5]!, alt: m[4] });
    else out.push({ t: "link", href: m[7]!, kids: parseInline(m[6]!) });
    last = re.lastIndex;
  }
  if (last < s.length) out.push({ t: "text", v: s.slice(last) });
  return out;
}

/**
 * Where an image in a README loads from: the web, or this repository
 * (relative to the README's folder; a leading "/" is the repository's top).
 * null for anything else (data:, javascript:, anchors).
 */
export function imagePath(url: string, base: string): { web: string } | { repo: string } | null {
  if (/^https?:\/\//i.test(url)) return { web: url };
  if (!url || url.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(url)) return null;
  const parts = url.startsWith("/") ? [] : base.split("/").filter(Boolean);
  for (const seg of url.split(/[?#]/)[0]!.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return { repo: parts.join("/") };
}

/** Where a link goes: the web (new tab), an anchor, a file in this repository, or nowhere. */
export function linkTarget(url: string): { web: string } | { anchor: string } | { repo: string } | null {
  if (/^(https?:\/\/|mailto:)/i.test(url)) return { web: url };
  if (url.startsWith("#")) return { anchor: url };
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return null;
  return { repo: url.replace(/^\.\/+/, "").replace(/^\/+/, "") };
}

/**
 * Comments on code hosts often carry HTML (badges, <details>, <br>). Turn it
 * into the text it shows: images become their alt text, breaks become new
 * lines, other tags go, common entities are decoded. Still only text.
 */
export function htmlToText(s: string): string {
  return String(s || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<img\b[^>]*\balt\s*=\s*"([^"]*)"[^>]*>/gi, "$1")
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<summary\b[^>]*>/gi, "**").replace(/<\/summary>/gi, "**\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|details)>/gi, "\n")
    .replace(/<\/?[a-z][\w-]*(?:\s[^<>]*)?\/?>/gi, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
