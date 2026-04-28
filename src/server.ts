import { serve } from '@hono/node-server';
import app from './index.js';
import { initDb } from './db.js';

const PORT = Number(process.env.PORT ?? 3003);

initDb().then(() => {
  serve({ fetch: app.fetch, port: PORT }, () => {
    console.log(`caster assassin running on http://localhost:${PORT}`);
    console.log(`  main snap:   http://localhost:${PORT}/`);
    console.log(`  player snap: http://localhost:${PORT}/player?fid=<fid>`);
  });
});
