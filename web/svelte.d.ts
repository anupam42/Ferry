// .svelte components seen from plain TypeScript (their own TypeScript is compiled by Svelte)
declare module "*.svelte" {
  import type { Component } from "svelte";
  const component: Component<Record<string, unknown>>;
  export default component;
}
