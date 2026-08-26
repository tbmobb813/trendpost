import { Hono } from 'hono';
import { rateLimiter } from '../rate-limit';

function buildApp(max: number, windowMs: number) {
  const app = new Hono();
  const limiter = rateLimiter({ max, windowMs, label: 'test' });
  app.use('/thing', limiter);
  app.get('/thing', (c) => c.json({ ok: true }));
  return app;
}

describe('rateLimiter()', () => {
  it('allows requests up to the max within the window', async () => {
    const app = buildApp(3, 60_000);
    for (let i = 0; i < 3; i++) {
      const res = await app.request('/thing');
      expect(res.status).toBe(200);
    }
  });

  it('returns 429 once the max is exceeded within the window', async () => {
    const app = buildApp(3, 60_000);
    for (let i = 0; i < 3; i++) await app.request('/thing');

    const res = await app.request('/thing');
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toMatch(/Rate limit exceeded/);
  });

  it('sets a Retry-After header on a throttled response', async () => {
    const app = buildApp(1, 60_000);
    await app.request('/thing');
    const res = await app.request('/thing');
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('resets the count once the window elapses', async () => {
    jest.useFakeTimers();
    try {
      const app = buildApp(1, 1000);
      const first = await app.request('/thing');
      expect(first.status).toBe(200);

      const throttled = await app.request('/thing');
      expect(throttled.status).toBe(429);

      jest.advanceTimersByTime(1001);

      const afterReset = await app.request('/thing');
      expect(afterReset.status).toBe(200);
    } finally {
      jest.useRealTimers();
    }
  });

  it('shares one counter across every path the same middleware instance is mounted on', async () => {
    const app = new Hono();
    const limiter = rateLimiter({ max: 1, windowMs: 60_000, label: 'shared' });
    app.use('/a', limiter);
    app.use('/b', limiter);
    app.get('/a', (c) => c.json({ ok: true }));
    app.get('/b', (c) => c.json({ ok: true }));

    const first = await app.request('/a');
    expect(first.status).toBe(200);

    const second = await app.request('/b');
    expect(second.status).toBe(429);
  });
});
