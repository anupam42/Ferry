// Files imported as text with `with { type: "text" }` (bundled into the binary).
declare module "*.svg" {
  const text: string;
  export default text;
}
