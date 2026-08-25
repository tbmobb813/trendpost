import './env'; // side-effect: populates process.env from .env / .env.local before anything below reads it

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { TrendPostStorage } from './storage';
import { startScheduler } from './scheduler';
import { registerHealthRoutes } from './routes/health';
import { registerCampaignRoutes } from './routes/campaigns';
import { registerIdeaRoutes } from './routes/ideas';
import { registerPostRoutes } from './routes/posts';
import { registerContentRoutes } from './routes/content';

const app = new Hono();
const storage = new TrendPostStorage();

registerHealthRoutes(app);
registerCampaignRoutes(app, storage);
registerIdeaRoutes(app, storage);
registerPostRoutes(app, storage);
registerContentRoutes(app, storage);

const port = Number(process.env.PORT) || 3000;

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[trendpost] listening on http://localhost:${info.port}`);
});

startScheduler(storage);
