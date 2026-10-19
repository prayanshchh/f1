import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import { build } from "vite";
import { repoRoot } from "./repo.ts";

export interface Bundle {
  directory: string;
  remove: () => void;
}

export async function bundleModule(entry: string): Promise<Bundle> {
  const directory = mkdtempSync(path.join(tmpdir(), "bundle-"));
  await build({
    configFile: false,
    root: repoRoot,
    logLevel: "error",
    publicDir: false,
    build: {
      outDir: directory,
      emptyOutDir: false,
      minify: false,
      copyPublicDir: false,
      lib: {
        entry: path.join(repoRoot, entry),
        formats: ["es"],
        fileName: () => "module.js",
      },
    },
  });
  return {
    directory,
    remove() {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

const contentTypes: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".glb": "model/gltf-binary",
  ".ktx2": "image/ktx2",
};

export async function serveDirectory(
  page: Page,
  prefix: string,
  directory: string,
  extra: Record<string, string> = {},
): Promise<void> {
  await page.route(`**/${prefix}/**`, async (route) => {
    const name = decodeURIComponent(
      new URL(route.request().url()).pathname,
    ).slice(prefix.length + 2);
    const type = contentTypes[path.extname(name)] ?? "application/octet-stream";
    const virtual = extra[name];
    if (virtual !== undefined) {
      await route.fulfill({ contentType: type, body: virtual });
      return;
    }
    const file = path.join(directory, name);
    if (!file.startsWith(directory + path.sep)) {
      await route.fulfill({ status: 404, body: "" });
      return;
    }
    try {
      await route.fulfill({ contentType: type, body: readFileSync(file) });
    } catch {
      await route.fulfill({ status: 404, body: "" });
    }
  });
}

const blankPage =
  '<!doctype html><html lang="en"><head><title>bundle</title></head><body></body></html>';

export async function serveBundle(page: Page, bundle: Bundle): Promise<void> {
  await serveDirectory(page, "__bundle", bundle.directory, {
    "index.html": blankPage,
  });
  await page.goto("/__bundle/index.html");
}

export function recordProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      problems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    problems.push(error.message);
  });
  return problems;
}
