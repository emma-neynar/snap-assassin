import { Hono } from 'hono';
import { registerSnapHandler } from '@farcaster/snap-hono';
import { mainSnap } from './pages/main.js';
import { playerHandler } from './player-handler.js';

const app = new Hono();

// Intercept /player before Hono's router matches it.
// registerSnapHandler internally calls app.use(path, cors()) which combined
// with app.get(path, handler) on the same non-root path corrupts Hono 4.12's
// matchResult in #dispatch. A global 'use' middleware runs before routing.
app.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (path === '/player' || path.startsWith('/player/')) {
    return playerHandler(c.req.raw, new URL(c.req.url));
  }
  return next();
});

// Main game snap at /
registerSnapHandler(app, mainSnap, {
  og: false,
  openGraph: {
    title: 'Caster Assassin',
    description: "An async elimination game on Farcaster. Hunt your target. Don't get got.",
  },
});

export default app;
