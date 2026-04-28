import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { registerSnapHandler } from '@farcaster/snap-hono';
import { MEDIA_TYPE, validateSnapResponse, snapResponseSchema, ACTION_TYPE_GET } from '@farcaster/snap';
import { snapJsonRenderCatalog } from '@farcaster/snap/ui';
import { parseRequest } from '@farcaster/snap/server';
import { mainSnap } from './pages/main.js';
import { playerSnap } from './pages/player.js';

const app = new Hono();

// Main game snap at /
registerSnapHandler(app, mainSnap, {
  og: false,
  openGraph: {
    title: 'Caster Assassin',
    description: "An async elimination game on Farcaster. Hunt your target. Don't get got.",
  },
});

// ── Player snap at /player ────────────────────────────────────────────────────
// Registered manually (not via registerSnapHandler) to avoid a Hono 4.12 routing
// bug where app.use(path, middleware) + app.get(path, handler) on the same
// non-root path causes matchResult[0] to be undefined in #dispatch.

function snapOrigin(req: Request): string {
  const fromEnv = process.env.SNAP_PUBLIC_BASE_URL?.trim();
  if (fromEnv) return new URL(fromEnv).origin;
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0].trim() ?? 'https';
  const host = req.headers.get('x-forwarded-host')?.split(',')[0].trim()
    ?? req.headers.get('host') ?? 'snap-assassin.vercel.app';
  return `${proto}://${host}`;
}

function buildPlayerResponse(payload: unknown, resourcePath: string): Response {
  const validation = validateSnapResponse(payload);
  if (!validation.valid) {
    return Response.json({ error: 'invalid snap page', issues: validation.issues }, { status: 400 });
  }
  const catalogResult = snapJsonRenderCatalog.validate((payload as any).ui);
  if (!catalogResult.success) {
    return Response.json({ error: 'invalid snap ui', issues: catalogResult.error?.issues ?? [] }, { status: 400 });
  }
  const finalized = snapResponseSchema.parse(payload);
  const link = [MEDIA_TYPE, 'text/html']
    .map(t => `<${resourcePath}>; rel="alternate"; type="${t}"`)
    .join(', ');
  return new Response(JSON.stringify(finalized), {
    status: 200,
    headers: { 'Content-Type': `${MEDIA_TYPE}; charset=utf-8`, Vary: 'Accept', Link: link },
  });
}

app.get('/player', cors({ origin: '*' }), async (c) => {
  const req = c.req.raw;
  const resourcePath = new URL(req.url).pathname + new URL(req.url).search;
  const payload = await playerSnap({ action: { type: ACTION_TYPE_GET }, request: req });
  return buildPlayerResponse(payload, resourcePath);
});

app.post('/player', cors({ origin: '*' }), async (c) => {
  const req = c.req.raw;
  const resourcePath = new URL(req.url).pathname + new URL(req.url).search;
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
    return c.json(body, status);
  }
  const payload = await playerSnap({ action: parsed.action, request: req });
  return buildPlayerResponse(payload, resourcePath);
});

export default app;
