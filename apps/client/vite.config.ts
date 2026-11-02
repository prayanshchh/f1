import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { apiServer } from "./api-server.ts";
import { padRelay } from "./pad-server.ts";

const headers = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  plugins: [apiServer(), padRelay()],
  server: {
    headers,
    fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] },
  },
  preview: { headers },
  assetsInclude: ["**/*.glb"],
  build: {
    target: "es2023",
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL("./index.html", import.meta.url)),
        drive: fileURLToPath(new URL("./drive.html", import.meta.url)),
        pad: fileURLToPath(new URL("./pad.html", import.meta.url)),
      },
    },
  },
});
