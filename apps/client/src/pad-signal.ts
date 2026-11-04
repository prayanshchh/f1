export interface PadOffer {
  id: string;
  seq: number;
  sdp: string;
}

export const inputChannel = "input";
export const controlChannel = "control";
export const peerConfig: RTCConfiguration = { iceServers: [] };
const gatherTimeout = 2000;
const retryDelay = 1000;

function path(room: string, rest: string): string {
  return `/api/pad/${encodeURIComponent(room)}/${rest}`;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function gathered(pc: RTCPeerConnection): Promise<string> {
  if (pc.iceGatheringState !== "complete")
    await new Promise<void>((resolve) => {
      const timer = setTimeout(finish, gatherTimeout);
      function finish() {
        clearTimeout(timer);
        pc.removeEventListener("icegatheringstatechange", check);
        resolve();
      }
      function check() {
        if (pc.iceGatheringState === "complete") finish();
      }
      pc.addEventListener("icegatheringstatechange", check);
    });
  return pc.localDescription?.sdp ?? "";
}

async function send(
  method: string,
  url: string,
  sdp: string,
): Promise<Response> {
  return fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sdp }),
  });
}

export async function postOffer(room: string, sdp: string): Promise<string> {
  const response = await send("POST", path(room, "offers"), sdp);
  if (!response.ok)
    throw new Error(`offer refused: ${String(response.status)}`);
  const body = (await response.json()) as { id: string };
  return body.id;
}

export async function waitAnswer(
  room: string,
  id: string,
): Promise<string | null> {
  for (;;) {
    const response = await fetch(path(room, `answers/${id}`));
    if (response.status === 404) return null;
    if (response.status === 200) {
      const body = (await response.json()) as { sdp: string };
      return body.sdp;
    }
    if (response.status !== 204) await delay(retryDelay);
  }
}

export async function waitOffers(
  room: string,
  after: number,
  signal: AbortSignal,
): Promise<PadOffer[]> {
  const response = await fetch(
    `${path(room, "offers")}?after=${String(after)}`,
    { signal },
  );
  if (!response.ok)
    throw new Error(`offers failed: ${String(response.status)}`);
  const body = (await response.json()) as { offers: PadOffer[] };
  return body.offers;
}

export async function postAnswer(
  room: string,
  id: string,
  sdp: string,
): Promise<boolean> {
  const response = await send("PUT", path(room, `answers/${id}`), sdp);
  return response.ok;
}
