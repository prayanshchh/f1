import { createHash } from "node:crypto";

export function keyHash(key: string): string {
  return createHash("sha256").update(key).digest("base64");
}
