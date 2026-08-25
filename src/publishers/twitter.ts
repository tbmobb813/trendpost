import { TwitterApi } from 'twitter-api-v2';
import type { PublishResult } from './index';

const REQUIRED_VARS = [
  'TWITTER_API_KEY',
  'TWITTER_API_SECRET',
  'TWITTER_ACCESS_TOKEN',
  'TWITTER_ACCESS_SECRET',
] as const;

export async function postToTwitter(content: string): Promise<PublishResult> {
  const missing = REQUIRED_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing Twitter credentials: ${missing.join(', ')}. Set them in .env — see ` +
        `docs/DEPLOYMENT.md's "Getting platform API credentials" section.`
    );
  }

  const client = new TwitterApi({
    appKey: process.env.TWITTER_API_KEY!,
    appSecret: process.env.TWITTER_API_SECRET!,
    accessToken: process.env.TWITTER_ACCESS_TOKEN!,
    accessSecret: process.env.TWITTER_ACCESS_SECRET!,
  });

  // A "\n\n---\n\n"-separated post is treated as a thread: each part posts
  // as a reply to the previous tweet, in order. A single part (the common
  // case) posts exactly as before — this is additive, not a behavior change
  // for existing single-tweet content.
  const parts = content
    .split(/\n\n---\n\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (parts.length <= 1) {
    const { data } = await client.v2.tweet(content);
    return { platformPostId: data.id, url: `https://twitter.com/i/web/status/${data.id}` };
  }

  const threadIds: string[] = [];
  let replyToId: string | undefined;
  for (const part of parts) {
    const { data } = await client.v2.tweet(
      replyToId ? { text: part, reply: { in_reply_to_tweet_id: replyToId } } : { text: part }
    );
    replyToId = data.id;
    threadIds.push(data.id);
    // Small delay between chained tweets to avoid bursting the rate limit.
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return {
    platformPostId: threadIds[0],
    url: `https://twitter.com/i/web/status/${threadIds[0]}`,
    threadIds,
  };
}
