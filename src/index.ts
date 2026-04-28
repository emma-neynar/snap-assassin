import { Hono } from 'hono';
import { registerSnapHandler } from '@farcaster/snap-hono';
import { mainSnap } from './pages/main.js';
import { playerSnap } from './pages/player.js';

const app = new Hono();

// Main game snap — registration, waiting room, active game dashboard
registerSnapHandler(app, mainSnap, {
  openGraph: {
    title: 'Caster Assassin',
    description: 'An async elimination game on Farcaster. Hunt your target. Don\'t get got.',
  },
});

// Profile snap — each player embeds this on their Farcaster profile
// URL format: /player?fid=<fid>
registerSnapHandler(app, playerSnap, {
  path: '/player',
  og: false,
  openGraph: {
    title: 'Caster Assassin — Player Profile',
    description: 'This player is in the game. Are you their assassin?',
  },
});

export default app;
