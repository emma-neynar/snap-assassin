import { MEDIA_TYPE, validateSnapResponse, snapResponseSchema } from '@farcaster/snap';
import { snapJsonRenderCatalog } from '@farcaster/snap/ui';
import { parseRequest } from '@farcaster/snap/server';
import { playerSnap } from '../src/pages/player.js';

export const config = { runtime: 'nodejs' };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
};

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

function buildLinkHeader(path: string): string {
  return [MEDIA_TYPE, 'text/html']
    .map(t => `<${path}>; rel="alternate"; type="${t}"`)
    .join(', ');
}

function snapResponse(payload: unknown, path: string): Response {
  const validation = validateSnapResponse(payload);
  if (!validation.valid) {
    return Response.json({ error: 'invalid snap page', issues: validation.issues }, { status: 400 });
  }
  const catalogResult = snapJsonRenderCatalog.validate((payload as any).ui);
  if (!catalogResult.success) {
    return Response.json({ error: 'invalid snap ui', issues: catalogResult.error?.issues ?? [] }, { status: 400 });
  }
  const finalized = snapResponseSchema.parse(payload);
  return new Response(JSON.stringify(finalized), {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': `${MEDIA_TYPE}; charset=utf-8`,
      Vary: 'Accept',
      Link: buildLinkHeader(path),
    },
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const path = resourcePath(req);

  if (req.method === 'GET') {
    const payload = await playerSnap({ action: { type: 'get' }, request: req });
    return snapResponse(payload, path);
  }

  if (req.method === 'POST') {
    const skipJFS = ['1', 'true', 'yes'].includes(
      process.env.SKIP_JFS_VERIFICATION?.trim().toLowerCase() ?? ''
    );
    const parsed = await parseRequest(req, { skipJFSVerification: skipJFS, requestOrigin: snapOrigin(req) });
    if (!parsed.success) {
      const err = parsed.error;
      const status = err.type === 'signature' || err.type === 'fid_mismatch' ? 401 : 400;
      const body = err.type === 'validation'
        ? { error: 'invalid POST body', issues: err.issues }
        : { error: err.message };
      return Response.json(body, { status, headers: CORS_HEADERS });
    }
    const payload = await playerSnap({ action: parsed.action, request: req });
    return snapResponse(payload, path);
  }

  return new Response('Method not allowed', { status: 405 });
}
