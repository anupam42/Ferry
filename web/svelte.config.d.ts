// Types for svelte.config.js (plain JavaScript, so svelte-check and ESLint can load it directly).
import type { PreprocessorGroup } from "svelte/compiler";

declare const config: { preprocess: PreprocessorGroup[]; compilerOptions: { runes: boolean } };
export default config;
