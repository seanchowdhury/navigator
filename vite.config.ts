import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import wasm from "vite-plugin-wasm";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), wasm()],
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "src") },
      // Resolve the WASM package straight from the repo (as tsconfig's `paths`
      // does) rather than node_modules: Vercel restores node_modules from its
      // build cache, which served a stale copy of this local file: dependency.
      {
        find: /^navigator_core$/,
        replacement: path.resolve(__dirname, "navigator_core/pkg/navigator_core.js"),
      },
    ],
  },
  build: {
    target: "esnext",
  },
  worker: {
    plugins: () => [wasm()],
    format: "es",
  },
});
