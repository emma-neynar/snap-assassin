import { Hono } from 'hono';
import { registerSnapHandler } from '@farcaster/snap-hono';
import { mainSnap } from './pages/main.js';

const app = new Hono();

registerSnapHandler(app, mainSnap, {
  og: false,
  openGraph: {
    title: 'Caster Assassin',
    description: "An async elimination game on Farcaster. Hunt your target. Don't get got.",
  },
});

export default app;
