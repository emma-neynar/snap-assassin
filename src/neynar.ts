const BASE = 'https://api.neynar.com/v2/farcaster';

function apiHeaders() {
  return {
    accept: 'application/json',
    api_key: process.env.NEYNAR_API_KEY ?? '',
  };
}

export async function getUsernameByFid(fid: number): Promise<string> {
  if (!process.env.NEYNAR_API_KEY) return `fid:${fid}`;
  try {
    const res = await fetch(`${BASE}/user/bulk?fids=${fid}`, { headers: apiHeaders() });
    if (!res.ok) return `fid:${fid}`;
    const data = (await res.json()) as { users?: Array<{ username?: string }> };
    return data.users?.[0]?.username ?? `fid:${fid}`;
  } catch {
    return `fid:${fid}`;
  }
}

// Sends a Farcaster notification via Neynar. Best-effort — never throws.
export async function notifyFid(fid: number, title: string, body: string): Promise<void> {
  if (!process.env.NEYNAR_API_KEY) return;
  try {
    await fetch(`${BASE}/notifications`, {
      method: 'POST',
      headers: { ...apiHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ fids: [fid], notification: { title, body } }),
    });
  } catch {
    // best-effort; ignore
  }
}
