import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { apiServer } from "./api-server.ts";
import { engineBuild } from "./engine-build.ts";
import { phoneTunnel } from "./phone-tunnel.ts";

const headers = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  plugins: [engineBuild(), phoneTunnel(), apiServer()],
  server: {
    headers,
    allowedHosts: [".trycloudflare.com"],
    fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] },
  },
  preview: { headers },
  assetsInclude: ["**/*.glb"],
  build: {
    target: "es2023",
    license: { fileName: "third-party-licenses.md" },
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL("./index.html", import.meta.url)),
        drive: fileURLToPath(new URL("./drive.html", import.meta.url)),
        pad: fileURLToPath(new URL("./pad.html", import.meta.url)),
      },
    },
  },
});
