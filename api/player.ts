import { Hono } from 'hono';
import { handle } from 'hono/vercel';
import { cors } from 'hono/cors';
import { MEDIA_TYPE, validateSnapResponse, snapResponseSchema } from '@farcaster/snap';
import { snapJsonRenderCatalog } from '@farcaster/snap/ui';
import { parseRequest } from '@farcaster/snap/server';
import { playerSnap } from '../src/pages/player.js';

export const config = { runtime: 'nodejs' };

const app = new Hono();

app.use('*', cors({ origin: '*' }));

function snapOrigin(req: Request): string {
  const fromEnv = process.env.SNAP_PUBLIC_BASE_URL?.trim();
  if (fromEnv) return new URL(fromEnv).origin;
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0].trim() ?? 'https';
  const host = req.headers.get('x-forwarded-host')?.split(',')[0].trim()
    ?? req.headers.get('host')
    ?? 'snap-assassin.vercel.app';
  return `${proto}://${host}`;
}

function buildSnapResponse(payload: unknown, req: Request): Response {
  const u = new URL(req.url);
  const resourcePath = u.pathname + u.search;

  const validation = validateSnapResponse(payload);
  if (!validation.valid) {
    return Response.json({ error: 'invalid snap page', issues: validation.issues }, { status: 400 });
  }
  const catalogResult = snapJsonRenderCatalog.validate((payload as any).ui);
  if (!catalogResult.success) {
    return Response.json({ error: 'invalid snap ui', issues: catalogResult.error?.issues ?? [] }, { status: 400 });
  }
  const finalized = snapResponseSchema.parse(payload);
  const linkHeader = [MEDIA_TYPE, 'text/html']
    .map(t => `<${resourcePath}>; rel="alternate"; type="${t}"`)
    .join(', ');

  return new Response(JSON.stringify(finalized), {
    status: 200,
    headers: {
      'Content-Type': `${MEDIA_TYPE}; charset=utf-8`,
      Vary: 'Accept',
      Link: linkHeader,
    },
  });
}

app.get('*', async (c) => {
  const req = c.req.raw;
  const payload = await playerSnap({ action: { type: 'get' }, request: req });
  return buildSnapResponse(payload, req);
});

app.post('*', async (c) => {
  const req = c.req.raw;
  const skipJFS = ['1', 'true', 'yes'].includes(
    process.env.SKIP_JFS_VERIFICATION?.trim().toLowerCase() ?? ''
  );
  const parsed = await parseRequest(req, {
    skipJFSVerification: skipJFS,
    requestOrigin: snapOrigin(req),
  });
  if (!parsed.success) {
    const err = parsed.error;
    const status = err.type === 'signature' || err.type === 'fid_mismatch' ? 401 : 400;
    const body = err.type === 'validation'
      ? { error: 'invalid POST body', issues: err.issues }
      : { error: err.message };
    return c.json(body, status);
  }
  const payload = await playerSnap({ action: parsed.action, request: req });
  return buildSnapResponse(payload, req);
});

export default handle(app);
