import { Hono } from 'hono';
import { TrendPostStorage } from '../storage';
import { listIdeas } from '../content';

export function registerIdeaRoutes(app: Hono, storage: TrendPostStorage): void {
  app.get('/api/ideas', (c) => {
    const status = c.req.query('status');
    return c.json(listIdeas(storage, status));
  });
}
