import { Hono } from 'hono';
import { TrendPostStorage } from '../storage';
import { createCampaign, listCampaigns } from '../content';

export function registerCampaignRoutes(app: Hono, storage: TrendPostStorage): void {
  app.post('/api/campaigns', async (c) => {
    const body = await c.req.json<{ name?: string }>();
    if (!body.name) return c.json({ error: 'name is required' }, 400);
    return c.json(createCampaign(storage, body.name), 201);
  });

  app.get('/api/campaigns', (c) => c.json(listCampaigns(storage)));
}
