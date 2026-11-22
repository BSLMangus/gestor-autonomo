import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath } from "node:url";

const asyncHooksPolyfillPath = fileURLToPath(
  new URL("./src/agent/asyncLocalStoragePolyfill.ts", import.meta.url)
);

export default defineConfig(({ mode }) => {
  const isCapacitor = mode === "capacitor";
  const isTest = mode === "test" || process.env.VITEST === "true";

  return {
    plugins: [
      react(),
      tailwindcss(),
      ...(!isCapacitor && !isTest
        ? [
            VitePWA({
              registerType: "autoUpdate",
              manifest: false,
              workbox: {
                maximumFileSizeToCacheInBytes: 35 * 1024 * 1024,
                globPatterns: ["**/*.{js,mjs,css,html,wasm,gz,svg,woff2,json,bcmap,pfb,ttf}"],
                navigateFallback: "index.html",
              },
            }),
          ]
        : []),
    ],
    optimizeDeps: {
      exclude: ["@sqlite.org/sqlite-wasm"],
    },
    resolve: {
      alias: !isTest
        ? ({
            async_hooks: asyncHooksPolyfillPath,
            "node:async_hooks": asyncHooksPolyfillPath,
          } as Record<string, string>)
        : ({} as Record<string, string>),
    },
    worker: {
      format: "es",
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalized = id.replace(/\\/g, "/");
            if (normalized.includes("/node_modules/tesseract.js/")) {
              return "chunk-ocr";
            }
            if (normalized.includes("/node_modules/pdfmake/")) {
              return "chunk-pdf";
            }
            if (normalized.includes("/node_modules/pdfjs-dist/")) {
              return "chunk-pdf-reader";
            }
            if (normalized.includes("/node_modules/@mediapipe/tasks-genai/")) {
              return "chunk-llm-web";
            }
            return undefined;
          },
        },
      },
    },
    test: {
      environment: "node",
      exclude: ["node_modules/**", "dist/**", "tests/e2e/**"],
    },
  };
});
