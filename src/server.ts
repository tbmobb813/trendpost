import './env'; // side-effect: populates process.env from .env / .env.local before anything below reads it

import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { TrendPostStorage } from './storage';
import { startScheduler } from './scheduler';
import { registerHealthRoutes } from './routes/health';
import { registerCampaignRoutes } from './routes/campaigns';
import { registerIdeaRoutes } from './routes/ideas';
import { registerPostRoutes } from './routes/posts';
import { registerContentRoutes } from './routes/content';
import { registerSettingsRoutes } from './routes/settings';
import { registerVerifyRoutes } from './routes/verify';
import { registerStatsRoutes } from './routes/stats';
import { registerRepurposeRoutes } from './routes/repurpose';
import { apiKeyAuth } from './auth';

if (!process.env.API_KEY) {
  console.warn(
    '\n' +
      '⚠️  ⚠️  ⚠️  WARNING: API_KEY is not set — every /api/* route is unauthenticated.  ⚠️  ⚠️  ⚠️\n' +
      '   Anyone who can reach this server can read/delete your data and use your Anthropic budget.\n' +
      '   Set API_KEY in .env before exposing this server beyond localhost or a private network\n' +
      '   (Tailscale/SSH tunnel) — see docs/DEPLOYMENT.md.\n'
  );
}

const app = new Hono();
const storage = new TrendPostStorage();

app.use('/api/*', apiKeyAuth());

registerHealthRoutes(app);
registerCampaignRoutes(app, storage);
registerIdeaRoutes(app, storage);
registerPostRoutes(app, storage);
registerContentRoutes(app, storage);
registerSettingsRoutes(app);
registerVerifyRoutes(app);
registerStatsRoutes(app, storage);
registerRepurposeRoutes(app, storage);

app.use('/*', serveStatic({ root: './public' }));

const port = Number(process.env.PORT) || 3000;

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[trendpost] listening on http://localhost:${info.port}`);
});

startScheduler(storage);
