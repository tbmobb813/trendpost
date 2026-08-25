import { Hono } from 'hono';

// Non-secret config only — never returns credential values, just whether
// each platform's required env vars are present.
export function registerSettingsRoutes(app: Hono): void {
  app.get('/api/settings', (c) => {
    return c.json({
      brandName: process.env.BRAND_NAME ?? null,
      productName: process.env.PRODUCT_NAME ?? null,
      brandVoice: process.env.BRAND_VOICE ?? null,
      publishCheckIntervalMs: Number(process.env.PUBLISH_CHECK_INTERVAL_MS) || 5 * 60 * 1000,
      platforms: {
        twitter: isConfigured([
          'TWITTER_API_KEY',
          'TWITTER_API_SECRET',
          'TWITTER_ACCESS_TOKEN',
          'TWITTER_ACCESS_SECRET',
        ]),
        linkedin: isConfigured(['LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_PERSON_URN']),
        facebook: isConfigured(['META_ACCESS_TOKEN', 'FACEBOOK_PAGE_ID']),
        instagram: isConfigured([
          'META_ACCESS_TOKEN',
          'INSTAGRAM_ACCOUNT_ID',
          'INSTAGRAM_DEFAULT_IMAGE_URL',
        ]),
      },
    });
  });
}

function isConfigured(requiredVars: string[]): boolean {
  return requiredVars.every((name) => !!process.env[name]);
}
