import { defineConfig } from "vite";
import { resolve } from "node:path";

/**
 * The build identifier is not produced here. The bundle keeps the
 * "__TEMPERATURE_CARD_BUILD__" placeholder verbatim; deploy.ps1 injects the
 * real identifier into the copy it writes to Home Assistant (same mechanism
 * as yardian-card's deploy.ps1).
 */
export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/temperature-card.ts"),
      formats: ["es"],
      fileName: () => "temperature-card.js",
    },
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
  },
});
