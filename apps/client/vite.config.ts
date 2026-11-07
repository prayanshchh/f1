import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { apiServer } from "./api-server.ts";
import { assetSizes } from "./asset-sizes.ts";
import { engineBuild } from "./engine-build.ts";
import { phoneTunnel } from "./phone-tunnel.ts";

const headers = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  plugins: [engineBuild(), phoneTunnel(), apiServer(), assetSizes()],
  server: {
    headers,
    allowedHosts: [".trycloudflare.com"],
    fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] },
  },
  preview: { headers },
  assetsInclude: ["**/*.glb"],
  worker: { format: "es" },
  build: {
    target: "es2023",
    license: { fileName: "third-party-licenses.md" },
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL("./index.html", import.meta.url)),
        phonepad: fileURLToPath(new URL("./phonepad.html", import.meta.url)),
      },
    },
  },
});
