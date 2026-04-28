import { MEDIA_TYPE, validateSnapResponse, snapResponseSchema, ACTION_TYPE_GET } from '@farcaster/snap';
import { snapJsonRenderCatalog } from '@farcaster/snap/ui';
import { parseRequest } from '@farcaster/snap/server';
import { playerSnap } from './pages/player.js';

const CORS = { 'Access-Control-Allow-Origin': '*' };

function snapOrigin(req: Request): string {
  const fromEnv = process.env.SNAP_PUBLIC_BASE_URL?.trim();
  if (fromEnv) return new URL(fromEnv).origin;
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0].trim() ?? 'https';
  const host = req.headers.get('x-forwarded-host')?.split(',')[0].trim()
    ?? req.headers.get('host') ?? 'snap-assassin.vercel.app';
  return `${proto}://${host}`;
}

function buildSnapResponse(payload: unknown, resourcePath: string): Response {
  const validation = validateSnapResponse(payload);
  if (!validation.valid) {
    return Response.json({ error: 'invalid snap page', issues: validation.issues }, { status: 400, headers: CORS });
  }
  const catalogResult = snapJsonRenderCatalog.validate((payload as any).ui);
  if (!catalogResult.success) {
    return Response.json({ error: 'invalid snap ui', issues: catalogResult.error?.issues ?? [] }, { status: 400, headers: CORS });
  }
  const finalized = snapResponseSchema.parse(payload);
  const link = [MEDIA_TYPE, 'text/html']
    .map(t => `<${resourcePath}>; rel="alternate"; type="${t}"`)
    .join(', ');
  return new Response(JSON.stringify(finalized), {
    status: 200,
    headers: {
      ...CORS,
      'Content-Type': `${MEDIA_TYPE}; charset=utf-8`,
      Vary: 'Accept',
      Link: link,
    },
  });
}

export async function playerHandler(req: Request, url: URL): Promise<Response> {
  const resourcePath = url.pathname + url.search;

  // Rebuild request with full URL so snap handlers can parse query params
  const fullReq = new Request(url.href, { method: req.method, headers: req.headers, body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined });

  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...CORS,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept',
      },
    });
  }

  if (req.method === 'GET') {
    const payload = await playerSnap({ action: { type: ACTION_TYPE_GET }, request: fullReq });
    return buildSnapResponse(payload, resourcePath);
  }

  if (req.method === 'POST') {
    const skipJFS = ['1', 'true', 'yes'].includes(
      process.env.SKIP_JFS_VERIFICATION?.trim().toLowerCase() ?? ''
    );
    const parsed = await parseRequest(fullReq, {
      skipJFSVerification: skipJFS,
      requestOrigin: snapOrigin(req),
    });
    if (!parsed.success) {
      const err = parsed.error;
      const status = err.type === 'signature' || err.type === 'fid_mismatch' ? 401 : 400;
      const body = err.type === 'validation'
        ? { error: 'invalid POST body', issues: err.issues }
        : { error: err.message };
      return Response.json(body, { status, headers: CORS });
    }
    const payload = await playerSnap({ action: parsed.action, request: fullReq });
    return buildSnapResponse(payload, resourcePath);
  }

  return new Response('Method not allowed', { status: 405, headers: CORS });
}
