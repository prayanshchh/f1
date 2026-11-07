const folder = "../../../../../content/tracks/hill-country/low/";
const files = import.meta.glob<string>(
  "../../../../../content/tracks/hill-country/low/*",
  { eager: true, query: "?url", import: "default" },
);

export function lowFile(name: string): string {
  const url = files[folder + name];
  if (url === undefined) throw new Error(`missing Low graphics file ${name}`);
  return url;
}

export function lowFiles(): string[] {
  return Object.values(files);
}

export async function fileBlob(url: string): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`${url} answered ${String(response.status)}`);
  return response.blob();
}

export async function fileJson<T>(url: string): Promise<T> {
  return JSON.parse(await (await fileBlob(url)).text()) as T;
}
