import type { MiddlewareHandler } from 'hono';

// Fixed-window counter, shared (not per-IP/per-key) across every route the
// middleware is mounted on — the threat this defends against is a leaked
// API_KEY or a buggy client retry loop burning the operator's own Anthropic
// budget, not per-caller fairness, so one global cap across all
// Anthropic-calling routes is simpler and can't be sidestepped by rotating
// source IPs the way a per-IP limiter could be. In-memory and per-process,
// consistent with the rest of the app's no-external-services design — a
// restart resets the window, which is an acceptable tradeoff for a
// single-operator self-hosted server.
export function rateLimiter(options: { windowMs: number; max: number; label: string }): MiddlewareHandler {
  let windowStart = Date.now();
  let count = 0;

  return async (c, next) => {
    const now = Date.now();
    if (now - windowStart >= options.windowMs) {
      windowStart = now;
      count = 0;
    }

    count++;
    if (count > options.max) {
      const retryAfterSec = Math.ceil((windowStart + options.windowMs - now) / 1000);
      c.header('Retry-After', String(retryAfterSec));
      return c.json(
        {
          error: `Rate limit exceeded for ${options.label}: max ${options.max} requests per ${Math.round(options.windowMs / 1000)}s. Retry after ${retryAfterSec}s.`,
        },
        429
      );
    }

    return next();
  };
}
