import { TrendPostStorage, ScheduledPost } from './storage';
import { listPosts, publishPost } from './content';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes — posts have real scheduled times

export interface PublishSweepResult {
  summary: string;
  published: ScheduledPost[];
  failed: ScheduledPost[];
}

// Sweeps every scheduled post whose scheduledAt time has arrived and
// publishes it. A post that fails to publish lands in status 'failed' with
// a diagnostic errorMessage (see publishPost) rather than aborting the
// sweep — one bad post must not block the rest of the batch.
export async function runPublishSweep(storage: TrendPostStorage): Promise<PublishSweepResult> {
  const due = listPosts(storage, { status: 'scheduled', dueOnly: true });

  if (due.length === 0) {
    return { summary: 'No posts were due to publish.', published: [], failed: [] };
  }

  const published: ScheduledPost[] = [];
  const failed: ScheduledPost[] = [];

  for (const post of due) {
    let result: ScheduledPost;
    try {
      result = await publishPost(storage, post.id);
    } catch (err) {
      // publishPost only swallows a *publisher* failure into the post's own
      // errorMessage — it still throws for a genuinely missing post (e.g.
      // deleted between the listing above and this loop reaching it). Record
      // it as a failure for this post specifically and keep sweeping.
      result = {
        ...post,
        status: 'failed',
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
    (result.status === 'published' ? published : failed).push(result);
  }

  const summary =
    `Published ${published.length}/${due.length} due post(s)` +
    (failed.length > 0
      ? `; failed: ${failed.map((f) => `${f.platform} (${f.errorMessage})`).join(', ')}`
      : '.');

  return { summary, published, failed };
}

// Interval loop, same shape as telegram-bot's healthLoop/pollLoop: run
// immediately, then every intervalMs, logging outcomes; a single sweep
// failure (e.g. a transient DB error) is logged and the loop keeps going
// rather than dying silently.
export function startScheduler(storage: TrendPostStorage): { stop: () => void } {
  const intervalMs = Number(process.env.PUBLISH_CHECK_INTERVAL_MS) || DEFAULT_INTERVAL_MS;
  let stopped = false;

  async function tick(): Promise<void> {
    if (stopped) return;
    try {
      const result = await runPublishSweep(storage);
      if (result.published.length > 0 || result.failed.length > 0) {
        console.log(`[scheduler] ${result.summary}`);
      }
    } catch (err) {
      console.error('[scheduler] sweep failed:', err instanceof Error ? err.message : err);
    }
  }

  void tick();
  const handle = setInterval(() => void tick(), intervalMs);

  console.log(`[scheduler] publish-due-posts sweep running every ${intervalMs / 1000}s`);

  return {
    stop: () => {
      stopped = true;
      clearInterval(handle);
    },
  };
}
