import type { Plugin } from "vite";

export function assetSizes(): Plugin {
  return {
    name: "revracers-asset-sizes",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(_html, context) {
        const sizes: Record<string, number> = {};
        for (const file of Object.values(context.bundle ?? {}))
          if (file.type === "asset")
            sizes[`/${file.fileName}`] =
              typeof file.source === "string"
                ? Buffer.byteLength(file.source)
                : file.source.byteLength;
        return [
          {
            tag: "script",
            attrs: { type: "application/json", "data-asset-sizes": true },
            children: JSON.stringify(sizes),
            injectTo: "head",
          },
        ];
      },
    },
  };
}
