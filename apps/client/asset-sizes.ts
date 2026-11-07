import type { HtmlTagDescriptor, Plugin } from "vite";

const brotliSuffix = ".br";

function sizeMap(
  name: string,
  sizes: Record<string, number>,
): HtmlTagDescriptor {
  return {
    tag: "script",
    attrs: { type: "application/json", [name]: true },
    children: JSON.stringify(sizes),
    injectTo: "head",
  };
}

export function assetSizes(): Plugin {
  return {
    name: "revracers-asset-sizes",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(_html, context) {
        const sizes: Record<string, number> = {};
        const wire: Record<string, number> = {};
        for (const file of Object.values(context.bundle ?? {})) {
          if (file.type !== "asset") continue;
          const size =
            typeof file.source === "string"
              ? Buffer.byteLength(file.source)
              : file.source.byteLength;
          if (file.fileName.endsWith(brotliSuffix))
            wire[`/${file.fileName.slice(0, -brotliSuffix.length)}`] = size;
          else sizes[`/${file.fileName}`] = size;
        }
        return [
          sizeMap("data-asset-sizes", sizes),
          sizeMap("data-asset-wire", wire),
        ];
      },
    },
  };
}
