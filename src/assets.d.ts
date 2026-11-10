// Files imported as text with `with { type: "text" }` (bundled into the binary).
declare module "*.svg" {
  const text: string;
  export default text;
}
declare module "*.md" {
  const text: string;
  export default text;
}

// the new web app's build output (src/web/next), embedded as text
declare module "*/web/next/app.js" {
  const text: string;
  export default text;
}
declare module "*.css" {
  const text: string;
  export default text;
}
