import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const headers = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  server: { headers },
  preview: { headers },
  build: {
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL("./index.html", import.meta.url)),
        play: fileURLToPath(new URL("./play.html", import.meta.url)),
        drive: fileURLToPath(new URL("./drive.html", import.meta.url)),
        scene: fileURLToPath(new URL("./scene.html", import.meta.url)),
      },
    },
  },
});
