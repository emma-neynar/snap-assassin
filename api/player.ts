import { Hono } from 'hono';
import { handle } from 'hono/vercel';
import { registerSnapHandler } from '@farcaster/snap-hono';
import { playerSnap } from '../src/pages/player.js';

export const config = { runtime: 'nodejs' };

const app = new Hono();

registerSnapHandler(app, playerSnap, {
  og: false,
  openGraph: {
    title: 'Caster Assassin — Player Profile',
    description: 'This player is in the game. Are you their assassin?',
  },
});

export default handle(app);
