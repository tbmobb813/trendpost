import { Hono } from 'hono';
import { TrendPostStorage, Platform } from '../storage';
import { extractFromUrl, extractYoutubeTranscript, NoCaptionsError } from '../repurpose/extract';
import { condenseIfNeeded } from '../repurpose/condense';
import { generateFromSource } from '../content';

export function registerRepurposeRoutes(app: Hono, storage: TrendPostStorage): void {
  app.post('/api/repurpose', async (c) => {
    const body = await c.req.json<{
      sourceType?: 'url' | 'youtube' | 'text';
      source?: string;
      platforms?: Platform[];
      postsCount?: number;
      autoApprove?: boolean;
      campaignName?: string;
    }>();

    if (!body.sourceType || !body.source || !body.platforms?.length) {
      return c.json({ error: 'sourceType, source, and platforms are required' }, 400);
    }

    let extracted: { title: string; text: string };
    try {
      if (body.sourceType === 'url') {
        extracted = await extractFromUrl(body.source);
      } else if (body.sourceType === 'youtube') {
        extracted = await extractYoutubeTranscript(body.source);
      } else {
        extracted = { title: body.campaignName ?? 'Pasted source', text: body.source };
      }
    } catch (err) {
      if (err instanceof NoCaptionsError) {
        return c.json({ error: err.message, fallback: 'sourceType: "text"' }, 422);
      }
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 422);
    }

    try {
      const condensed = await condenseIfNeeded(extracted.text);

      const result = await generateFromSource(storage, {
        sourceTitle: extracted.title,
        sourceText: condensed,
        platforms: body.platforms,
        postsCount: body.postsCount,
        autoApprove: body.autoApprove,
        campaignName: body.campaignName,
      });

      return c.json(result, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 422);
    }
  });
}
