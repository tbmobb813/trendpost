import { Hono } from 'hono';
import { apiKeyAuth } from '../auth';

function buildApp() {
  const app = new Hono();
  app.use('/api/*', apiKeyAuth());
  app.get('/api/thing', (c) => c.json({ ok: true }));
  return app;
}

describe('apiKeyAuth()', () => {
  const originalApiKey = process.env.API_KEY;

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.API_KEY;
    } else {
      process.env.API_KEY = originalApiKey;
    }
  });

  it('passes requests through when API_KEY is unset', async () => {
    delete process.env.API_KEY;
    const app = buildApp();

    const res = await app.request('/api/thing');
    expect(res.status).toBe(200);
  });

  it('rejects requests with no Authorization header when API_KEY is set', async () => {
    process.env.API_KEY = 'secret123';
    const app = buildApp();

    const res = await app.request('/api/thing');
    expect(res.status).toBe(401);
  });

  it('rejects requests with the wrong key', async () => {
    process.env.API_KEY = 'secret123';
    const app = buildApp();

    const res = await app.request('/api/thing', {
      headers: { Authorization: 'Bearer wrong' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects a malformed Authorization header (missing Bearer prefix)', async () => {
    process.env.API_KEY = 'secret123';
    const app = buildApp();

    const res = await app.request('/api/thing', {
      headers: { Authorization: 'secret123' },
    });
    expect(res.status).toBe(401);
  });

  it('allows requests with the correct Bearer key', async () => {
    process.env.API_KEY = 'secret123';
    const app = buildApp();

    const res = await app.request('/api/thing', {
      headers: { Authorization: 'Bearer secret123' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
