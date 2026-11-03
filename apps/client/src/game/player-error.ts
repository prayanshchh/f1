export class PlayerError extends Error {}

export function playerMessage(error: unknown, fallback: string): string {
  if (error instanceof PlayerError) return error.message;
  reportError(error);
  return fallback;
}
