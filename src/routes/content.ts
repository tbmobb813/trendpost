import { Hono } from 'hono';
import { TrendPostStorage, Platform } from '../storage';
import { generateContent, generatePlan, generatePlanFromTimeline, analyzeContent } from '../content';

export function registerContentRoutes(app: Hono, storage: TrendPostStorage): void {
  app.post('/api/content/generate', async (c) => {
    const body = await c.req.json<{
      topic?: string;
      platform?: Platform;
      tone?: string;
      context?: string;
    }>();
    if (!body.topic || !body.platform) {
      return c.json({ error: 'topic and platform are required' }, 400);
    }
    return c.json(
      await generateContent({
        topic: body.topic,
        platform: body.platform,
        tone: body.tone,
        context: body.context,
      })
    );
  });

  app.post('/api/content/plan', async (c) => {
    const body = await c.req.json<{
      businessContext?: string;
      platforms?: Platform[];
      weeksAhead?: number;
      postsPerWeek?: number;
      campaignId?: string;
    }>();
    if (!body.platforms?.length) return c.json({ error: 'platforms is required' }, 400);
    return c.json(
      await generatePlan(storage, {
        businessContext: body.businessContext,
        platforms: body.platforms,
        weeksAhead: body.weeksAhead,
        postsPerWeek: body.postsPerWeek,
        campaignId: body.campaignId,
      })
    );
  });

  app.post('/api/content/plan-from-timeline', async (c) => {
    const body = await c.req.json<{
      productName?: string;
      timeline?: { week: string; focus: string; tasks: string[] }[];
      platforms?: Platform[];
      campaignName?: string;
    }>();
    if (!body.productName || !body.timeline?.length || !body.platforms?.length) {
      return c.json({ error: 'productName, timeline, and platforms are required' }, 400);
    }
    return c.json(
      generatePlanFromTimeline(storage, {
        productName: body.productName,
        timeline: body.timeline,
        platforms: body.platforms,
        campaignName: body.campaignName,
      })
    );
  });

  app.post('/api/content/analyze', async (c) => {
    const body = await c.req.json<{ content?: string; platform?: Platform }>();
    if (!body.content || !body.platform) {
      return c.json({ error: 'content and platform are required' }, 400);
    }
    return c.json(await analyzeContent({ content: body.content, platform: body.platform }));
  });
}
