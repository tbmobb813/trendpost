import { Hono } from 'hono';
import { verifyAnthropic, verifyTwitter, verifyLinkedin, verifyFacebook, verifyInstagram } from '../verify';

// Stateless credential-check endpoints for the setup wizard (public/setup.html).
// Each accepts credentials in the request body, makes one live read-only
// call to the platform, and returns the result — nothing here is ever
// logged or persisted. Saving credentials happens by the user pasting the
// wizard's generated .env block into their own .env file, not through
// this route.
export function registerVerifyRoutes(app: Hono): void {
  app.post('/api/verify/anthropic', async (c) => {
    const { apiKey } = await c.req.json<{ apiKey?: string }>();
    if (!apiKey) return c.json({ ok: false, message: 'apiKey is required' }, 400);
    return c.json(await verifyAnthropic(apiKey));
  });

  app.post('/api/verify/twitter', async (c) => {
    const { apiKey, apiSecret, accessToken, accessSecret } = await c.req.json<{
      apiKey?: string;
      apiSecret?: string;
      accessToken?: string;
      accessSecret?: string;
    }>();
    if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
      return c.json({ ok: false, message: 'apiKey, apiSecret, accessToken, and accessSecret are all required' }, 400);
    }
    return c.json(await verifyTwitter(apiKey, apiSecret, accessToken, accessSecret));
  });

  app.post('/api/verify/linkedin', async (c) => {
    const { accessToken, personUrn } = await c.req.json<{ accessToken?: string; personUrn?: string }>();
    if (!accessToken || !personUrn) {
      return c.json({ ok: false, message: 'accessToken and personUrn are required' }, 400);
    }
    return c.json(await verifyLinkedin(accessToken, personUrn));
  });

  app.post('/api/verify/facebook', async (c) => {
    const { accessToken, pageId } = await c.req.json<{ accessToken?: string; pageId?: string }>();
    if (!accessToken || !pageId) {
      return c.json({ ok: false, message: 'accessToken and pageId are required' }, 400);
    }
    return c.json(await verifyFacebook(accessToken, pageId));
  });

  app.post('/api/verify/instagram', async (c) => {
    const { accessToken, accountId } = await c.req.json<{ accessToken?: string; accountId?: string }>();
    if (!accessToken || !accountId) {
      return c.json({ ok: false, message: 'accessToken and accountId are required' }, 400);
    }
    return c.json(await verifyInstagram(accessToken, accountId));
  });
}
