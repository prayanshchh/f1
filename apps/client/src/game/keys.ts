const scancodeMask = 1 << 30;

const named: Record<string, number> = {
  ArrowRight: scancodeMask | 79,
  ArrowLeft: scancodeMask | 80,
  ArrowDown: scancodeMask | 81,
  ArrowUp: scancodeMask | 82,
  PageUp: scancodeMask | 75,
  PageDown: scancodeMask | 78,
  Home: scancodeMask | 74,
  End: scancodeMask | 77,
  Insert: scancodeMask | 73,
  Enter: 13,
  Escape: 27,
  Backspace: 8,
  Tab: 9,
  " ": 32,
};

export function sdlKeycode(event: KeyboardEvent): number | null {
  const fixed = named[event.key];
  if (fixed !== undefined) return fixed;
  const fn = /^F(\d{1,2})$/.exec(event.key);
  if (fn) return scancodeMask | (57 + Number(fn[1]));
  if (event.key.length === 1) return event.key.toLowerCase().charCodeAt(0);
  return null;
}
