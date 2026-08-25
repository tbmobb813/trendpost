import { Hono } from 'hono';
import { TrendPostStorage } from '../storage';

export function registerStatsRoutes(app: Hono, storage: TrendPostStorage): void {
  app.get('/api/stats', (c) => {
    return c.json(storage.getStats());
  });

  app.get('/api/logs', (c) => {
    const limit = c.req.query('limit');
    return c.json(storage.recentLogs(limit ? Number(limit) : undefined));
  });
}
