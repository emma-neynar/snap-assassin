import { handle } from 'hono/vercel';
import mainApp from '../src/index.js';
import { playerHandler } from '../src/player-handler.js';

export const config = { runtime: 'nodejs' };

const mainHandle = handle(mainApp);

export default async function handler(req: Request): Promise<Response> {
  // Route /player requests before they hit Hono to avoid a router bug
  // in hono@4.12 where app.use(path, mw) + app.get(path, handler) on
  // the same non-root path causes matchResult[0] to be undefined.
  const url = new URL(req.url, 'https://snap-assassin.vercel.app');
  if (url.pathname === '/player' || url.pathname.startsWith('/player/')) {
    return playerHandler(req, url);
  }
  return mainHandle(req);
}
