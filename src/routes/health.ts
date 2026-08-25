import { Hono } from 'hono';

export function registerHealthRoutes(app: Hono): void {
  app.get('/health', (c) =>
    c.json({
      status: 'ok',
      uptime: process.uptime(),
      time: new Date().toISOString(),
    })
  );
}
