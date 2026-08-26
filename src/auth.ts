import type { MiddlewareHandler } from 'hono';

// Fails open when API_KEY isn't configured — preserves the zero-config
// clone/install/start experience for local or trusted-network use.
// docs/DEPLOYMENT.md already recommends network-level isolation
// (Tailscale/SSH tunnel) as the primary control; this is defense-in-depth
// for the case that isolation slips, not the only line of protection —
// server.ts logs a loud startup warning when this is the active mode.
export function apiKeyAuth(): MiddlewareHandler {
  const configuredKey = process.env.API_KEY;

  return async (c, next) => {
    if (!configuredKey) return next();

    const header = c.req.header('Authorization');
    const provided = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

    if (provided !== configuredKey) {
      return c.json({ error: 'Unauthorized — missing or invalid API key' }, 401);
    }

    return next();
  };
}
