import { Hono } from 'hono';
import { TrendPostStorage, Platform, PostStatus } from '../storage';
import {
  schedulePost,
  listPosts,
  deletePost,
  publishPost,
  markPublished,
  approvePost,
  approveAllDrafts,
} from '../content';
import { runPublishSweep } from '../scheduler';

export function registerPostRoutes(app: Hono, storage: TrendPostStorage): void {
  app.post('/api/posts', async (c) => {
    const body = await c.req.json<{
      content?: string;
      platform?: Platform;
      scheduledAt?: string;
      tags?: string[];
      campaignId?: string;
      autoApprove?: boolean;
    }>();
    if (!body.content || !body.platform || !body.scheduledAt) {
      return c.json({ error: 'content, platform, and scheduledAt are required' }, 400);
    }
    return c.json(
      schedulePost(storage, {
        content: body.content,
        platform: body.platform,
        scheduledAt: body.scheduledAt,
        tags: body.tags,
        campaignId: body.campaignId,
        autoApprove: body.autoApprove,
      }),
      201
    );
  });

  app.post('/api/posts/approve-all', (c) => {
    return c.json(approveAllDrafts(storage));
  });

  app.post('/api/posts/:id/approve', (c) => {
    const post = approvePost(storage, c.req.param('id'));
    if (!post) return c.json({ error: 'post not found' }, 404);
    return c.json(post);
  });

  app.get('/api/posts', (c) => {
    const status = c.req.query('status') as PostStatus | undefined;
    const platform = c.req.query('platform') as Platform | undefined;
    const daysAhead = c.req.query('daysAhead');
    const daysAgo = c.req.query('daysAgo');
    const dueOnly = c.req.query('dueOnly');

    return c.json(
      listPosts(storage, {
        status,
        platform,
        daysAhead: daysAhead ? Number(daysAhead) : undefined,
        daysAgo: daysAgo ? Number(daysAgo) : undefined,
        dueOnly: dueOnly === 'true',
      })
    );
  });

  app.delete('/api/posts/:id', (c) => {
    deletePost(storage, c.req.param('id'));
    return c.json({ deleted: true });
  });

  app.post('/api/posts/:id/publish', async (c) => {
    const post = await publishPost(storage, c.req.param('id'));
    return c.json(post);
  });

  app.post('/api/posts/:id/mark-published', (c) => {
    const post = markPublished(storage, c.req.param('id'));
    if (!post) return c.json({ error: 'post not found' }, 404);
    return c.json(post);
  });

  // Manual trigger for the same sweep the scheduler runs on its own
  // interval — mirrors the old cron-driven /api/tasks/publish-due-posts
  // endpoint for parity, useful for testing before enabling automation.
  app.post('/api/tasks/publish-due-posts', async (c) => {
    const result = await runPublishSweep(storage);
    return c.json(result);
  });
}
