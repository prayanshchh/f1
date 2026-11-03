export const phoneSitePath = "/__phone/site";

export interface PhoneSite {
  origin: string | null;
  problem: string | null;
}

export function padAddress(
  pageOrigin: string,
  site: PhoneSite | null,
  room: string,
): string | null {
  const origin = site ? site.origin : pageOrigin;
  return origin ? `${origin}/pad.html#${room}` : null;
}

export async function phoneSite(): Promise<PhoneSite | null> {
  const answer = await fetch(phoneSitePath).catch(() => null);
  if (!answer?.ok) return null;
  return (await answer.json().catch(() => null)) as PhoneSite | null;
}
