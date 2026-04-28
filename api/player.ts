import { MEDIA_TYPE, ACTION_TYPE_GET } from '@farcaster/snap';
import { parseRequest } from '@farcaster/snap/server';
import { payloadToResponse } from '@farcaster/snap-hono/dist/payloadToResponse.js';
import { playerSnap } from '../src/pages/player.js';

export const config = { runtime: 'nodejs' };

function snapOrigin(req: Request): string {
  const fromEnv = process.env.SNAP_PUBLIC_BASE_URL?.trim();
  if (fromEnv) return new URL(fromEnv).origin;
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0].trim() ?? 'https';
  const host = req.headers.get('x-forwarded-host')?.split(',')[0].trim()
    ?? req.headers.get('host')
    ?? 'snap-assassin.vercel.app';
  return `${proto}://${host}`;
}

function resourcePath(req: Request): string {
  const u = new URL(req.url);
  return u.pathname + u.search;
}

export default async function handler(req: Request): Promise<Response> {
  const accept = req.headers.get('accept') ?? '';
  const wantsSnap = accept.toLowerCase().split(',').some(p =>
    p.trim().split(';')[0]?.trim().toLowerCase() === MEDIA_TYPE.toLowerCase()
  );

  if (req.method === 'GET') {
    const snap = await playerSnap({ action: { type: ACTION_TYPE_GET }, request: req });
    if (wantsSnap) {
      return payloadToResponse(snap, { resourcePath: resourcePath(req), mediaTypes: [MEDIA_TYPE, 'text/html'] });
    }
    // Plain browser hit — return minimal HTML so the URL at least resolves
    return new Response(`<!doctype html><title>Caster Assassin</title><p>This player is in the game.</p>`, {
      headers: { 'content-type': 'text/html' },
    });
  }

  if (req.method === 'POST') {
    const skipJFS = process.env.SKIP_JFS_VERIFICATION?.toLowerCase() === '1'
      || process.env.SKIP_JFS_VERIFICATION?.toLowerCase() === 'true';
    const parsed = await parseRequest(req, { skipJFSVerification: skipJFS, requestOrigin: snapOrigin(req) });
    if (!parsed.success) {
      const err = parsed.error;
      const status = err.type === 'signature' || err.type === 'fid_mismatch' ? 401 : 400;
      return Response.json({ error: err.message }, { status });
    }
    const snap = await playerSnap({ action: parsed.action, request: req });
    return payloadToResponse(snap, { resourcePath: resourcePath(req), mediaTypes: [MEDIA_TYPE, 'text/html'] });
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept',
      },
    });
  }

  return new Response('Method not allowed', { status: 405 });
}
