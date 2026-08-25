import Anthropic from '@anthropic-ai/sdk';
import { TrendPostStorage, Platform, PostStatus, ScheduledPost, ContentIdea, Campaign } from './storage';
import { publishToPlatform } from './publishers';

const DAY_MS = 24 * 60 * 60 * 1000;

// Spreads `count` items evenly across the [tomorrow, tomorrow + weeksAhead*7)
// window — extracted as a pure function so the date math is unit-testable
// without mocking the LLM client that generatePlan also calls.
export function distributeDates(
  count: number,
  weeksAhead: number,
  from: Date = new Date()
): Date[] {
  if (count <= 0) return [];
  const totalDays = Math.max(weeksAhead, 1) * 7;
  const start = new Date(from.getTime() + DAY_MS);
  start.setUTCHours(9, 0, 0, 0);
  const step = totalDays / count;
  return Array.from(
    { length: count },
    (_, i) => new Date(start.getTime() + Math.round(i * step) * DAY_MS)
  );
}

// Parses a leading integer out of a launch timeline week label (e.g. "Week
// 1", "Week 2: Launch") — falls back to sequential position (1-indexed) when
// the label doesn't start with a number, so a week is never skipped.
export function timelineWeekNumber(label: string, fallbackIndex: number): number {
  const match = label.match(/\d+/);
  return match ? parseInt(match[0], 10) : fallbackIndex + 1;
}

const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5';

function parseJson<T>(raw: string, context: string): T {
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    return JSON.parse(stripped) as T;
  } catch {
    throw new Error(`${context} returned unparseable JSON: ${stripped.slice(0, 200)}`);
  }
}

const client = new Anthropic();

// Falls back to the brand identity configured in .env when a caller doesn't
// supply businessContext explicitly — lets the scheduler and unattended
// batch generation run without a human typing context in on every call.
function defaultBusinessContext(): string | undefined {
  const { BRAND_NAME, PRODUCT_NAME, BRAND_VOICE } = process.env;
  if (!BRAND_NAME && !PRODUCT_NAME && !BRAND_VOICE) return undefined;
  return [
    BRAND_NAME && `Brand: ${BRAND_NAME}`,
    PRODUCT_NAME && `Product: ${PRODUCT_NAME}`,
    BRAND_VOICE && `Voice: ${BRAND_VOICE}`,
  ]
    .filter(Boolean)
    .join('. ');
}

const CONTENT_SYSTEM_PROMPT = `You are a professional content writer for solo business operators.
You write content that is:
- Authentic and direct — no corporate fluff
- Platform-appropriate in length and tone
- Focused on one clear idea per post
- Written in first person, active voice

PLATFORM GUIDELINES:
- twitter/threads: 280 chars max, punchy, no hashtag spam (1-2 max)
- linkedin: 150-300 words, professional but human, end with a question or insight
- instagram: visual-first, 100-150 words, 3-5 relevant hashtags at the end

Never use phrases like "Excited to share" or "Thrilled to announce".
Never use excessive emojis.
Write like a smart human, not a marketing bot.

When business context is given, the post must be specific to that business — not
content that could have been written for anyone in the same industry. When no business
context is given, don't invent fake specifics (numbers, customer stories, product
details) to fill the gap — write a solid, topic-focused post that stays honest about
what you actually know.`;

// ── GENERATE CONTENT ────────────────────────────────────────────
export async function generateContent(
  params: {
    topic: string;
    platform: Platform;
    tone?: string;
    context?: string;
  },
  storage?: TrendPostStorage
): Promise<{ content: string; platform: Platform; topic: string }> {
  const { topic, platform, tone } = params;
  const context = params.context ?? defaultBusinessContext();

  const prompt = `Write a ${platform} post about: ${topic}
${tone ? `Tone: ${tone}` : ''}
${context ? `Business context: ${context}` : ''}

Return ONLY the post content. No labels, no explanations, no quotes around it.`;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: CONTENT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    storage?.log('GENERATED', platform, undefined, topic);
    return { content, platform, topic };
  } catch (err) {
    storage?.log('GEN_ERROR', platform, undefined, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

// ── GENERATE CONTENT PLAN ───────────────────────────────────────
export async function generatePlan(
  storage: TrendPostStorage,
  params: {
    businessContext?: string;
    platforms: Platform[];
    weeksAhead?: number;
    postsPerWeek?: number;
    campaignId?: string;
  }
): Promise<{ ideas: ContentIdea[]; totalGenerated: number }> {
  const { platforms, weeksAhead = 1, postsPerWeek = 3, campaignId } = params;
  const businessContext = params.businessContext ?? defaultBusinessContext();
  if (!businessContext) {
    throw new Error(
      'businessContext is required (or set BRAND_NAME/PRODUCT_NAME/BRAND_VOICE in .env as a default).'
    );
  }

  const totalPosts = weeksAhead * postsPerWeek;
  const prompt = `Create a content plan for a solo business operator.

Business context: ${businessContext}
Platforms: ${platforms.join(', ')}
Posts needed: ${totalPosts} posts over ${weeksAhead} week(s)

Distribute posts across ALL of the given platforms roughly evenly — don't default every
idea to the first one. Every idea must be specific to the business context above, not a
generic content-calendar filler topic that could apply to any business in the industry.

Return a JSON array of content ideas. Each item:
{
  "topic": "specific topic grounded in the business context",
  "angle": "unique angle or hook",
  "platform": "one of: ${platforms.join(', ')}",
  "suggestedDay": "Monday"
}

Return only valid JSON array. No markdown fences.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: CONTENT_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const ideas = parseJson<
    Array<{ topic: string; angle: string; platform: Platform; suggestedDay?: string }>
  >(raw, 'generatePlan');

  const dates = distributeDates(ideas.length, weeksAhead);
  const saved = ideas.map((idea, i) =>
    storage.createIdea({
      topic: idea.topic,
      angle: idea.angle,
      platform: idea.platform,
      scheduledFor: dates[i],
      campaignId,
    })
  );

  storage.log('PLAN_GENERATED', undefined, undefined, `${saved.length} idea(s) across ${platforms.join(', ')}`);
  return { ideas: saved, totalGenerated: saved.length };
}

// ── GENERATE POSTS FROM A REPURPOSED SOURCE ─────────────────────
// Unlike generatePlan (which produces topic/angle ideas), this produces
// real, ready-to-schedule post content directly from source material
// (a blog article, a video transcript) — the point of repurposing is
// getting posts back, not more ideas to write from scratch.
export async function generateFromSource(
  storage: TrendPostStorage,
  params: {
    sourceTitle?: string;
    sourceText: string;
    platforms: Platform[];
    postsCount?: number;
    autoApprove?: boolean;
    campaignName?: string;
  }
): Promise<{ posts: ScheduledPost[]; campaign: Campaign }> {
  const { sourceTitle, sourceText, platforms, postsCount = 5, campaignName } = params;
  const autoApprove = params.autoApprove ?? process.env.AUTO_APPROVE === 'true';

  if (sourceText.trim().length < 200) {
    throw new Error('sourceText is too short to repurpose (under 200 characters) — extraction likely failed.');
  }

  const businessContext = defaultBusinessContext();
  const prompt = `Source material${sourceTitle ? ` ("${sourceTitle}")` : ''}:
${sourceText}

Extract ${postsCount} distinct, specific posts from the source material above, spread across these platforms: ${platforms.join(', ')}.
Distribute posts across ALL of the given platforms roughly evenly — don't default every post to the first one.
Each post must be grounded in a specific point, claim, quote, or example from the source — not a generic paraphrase of "what this is about."
${businessContext ? `Business context (match this voice, don't just describe the source): ${businessContext}` : ''}

Return a JSON array. Each item:
{
  "content": "the full ready-to-post text, following the platform rules below",
  "platform": "one of: ${platforms.join(', ')}"
}

PLATFORM GUIDELINES:
- twitter/threads: 280 chars max, punchy, no hashtag spam (1-2 max)
- linkedin: 150-300 words, professional but human, end with a question or insight
- instagram: visual-first, 100-150 words, 3-5 relevant hashtags at the end
- facebook: 80-200 words, conversational, ask a question to drive comments

Return only valid JSON array. No markdown fences.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: CONTENT_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const extracted = parseJson<Array<{ content: string; platform: Platform }>>(raw, 'generateFromSource');

  const campaign = storage.createCampaign({
    name: campaignName ?? sourceTitle ?? 'Repurposed content',
    source: 'repurpose',
  });

  const dates = distributeDates(extracted.length, 1);
  const posts = extracted.map((item, i) =>
    storage.createPost({
      content: item.content,
      platform: item.platform,
      scheduledAt: dates[i],
      campaignId: campaign.id,
      status: autoApprove ? 'scheduled' : 'draft',
    })
  );

  storage.log('REPURPOSED', undefined, undefined, `${posts.length} post(s) from "${sourceTitle ?? 'source'}"`);
  return { posts, campaign };
}

// ── GENERATE CONTENT PLAN FROM A LAUNCH TIMELINE ────────────────
// Deterministic mapping, no LLM call — the caller already did the planning
// work; this just turns a weekly timeline into dated content ideas.
export function generatePlanFromTimeline(
  storage: TrendPostStorage,
  params: {
    productName: string;
    timeline: { week: string; focus: string; tasks: string[] }[];
    platforms: Platform[];
    campaignName?: string;
  }
): { ideas: ContentIdea[]; totalGenerated: number; campaign: Campaign } {
  const { productName, timeline, platforms, campaignName } = params;

  const campaign = storage.createCampaign({
    name: campaignName ?? `${productName} launch`,
    source: 'manual',
  });

  const now = new Date();
  const ideas = timeline.map((week, i) => {
    const weekNumber = timelineWeekNumber(week.week, i);
    const scheduledFor = new Date(now.getTime() + (weekNumber - 1) * 7 * DAY_MS);
    scheduledFor.setHours(9, 0, 0, 0);
    const platform = platforms[i % platforms.length];

    return storage.createIdea({
      topic: week.focus,
      angle: week.tasks.join('; '),
      platform,
      scheduledFor,
      campaignId: campaign.id,
    });
  });

  return { ideas, totalGenerated: ideas.length, campaign };
}

// ── CAMPAIGNS ────────────────────────────────────────────────────
export function createCampaign(storage: TrendPostStorage, name: string): Campaign {
  return storage.createCampaign({ name, source: 'manual' });
}

export function listCampaigns(storage: TrendPostStorage): Campaign[] {
  return storage.listCampaigns();
}

// ── MARK PUBLISHED ────────────────────────────────────────────────
// Self-report only — for confirming a post published manually outside this
// system. Does not touch any real platform. See publishPost below for the
// function that actually publishes.
export function markPublished(storage: TrendPostStorage, postId: string): ScheduledPost | null {
  storage.updatePostStatus(postId, 'published');
  return storage.getPost(postId);
}

// ── PUBLISH POST ───────────────────────────────────────────────────
// Actually publishes to the post's real platform (Twitter, LinkedIn,
// Facebook, or Instagram) via publishers/. Called both by the manual
// /api/posts/:id/publish route and by the scheduler's due-post sweep.
// Swallows the publisher's error into the post's errorMessage rather than
// rethrowing, so one failed post in a sweep doesn't abort the rest of the
// batch — the caller decides what to do with a `failed` status.
export async function publishPost(
  storage: TrendPostStorage,
  postId: string
): Promise<ScheduledPost> {
  const post = storage.getPost(postId);
  if (!post) throw new Error(`No post found with id ${postId}`);

  try {
    const result = await publishToPlatform(post.platform, post.content);
    storage.updatePostStatus(postId, 'published', undefined, result.platformPostId);
    storage.log('POSTED', post.platform, postId, result.url);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    storage.updatePostStatus(postId, 'failed', message);
    storage.log('FAILED', post.platform, postId, message);
  }

  return storage.getPost(postId)!;
}

// ── SCHEDULE POST ──────────────────────────────────────────────
// autoApprove decides whether the post lands as 'scheduled' (goes out on
// its own once due) or 'draft' (sits until approvePost/approveAllDrafts
// promotes it) — defaults to the AUTO_APPROVE env var so unattended batch
// generation and the scheduler behave consistently with what a human
// scheduling one post at a time gets by default.
export function schedulePost(
  storage: TrendPostStorage,
  params: {
    content: string;
    platform: Platform;
    scheduledAt: string;
    tags?: string[];
    campaignId?: string;
    autoApprove?: boolean;
  }
): ScheduledPost {
  const autoApprove = params.autoApprove ?? process.env.AUTO_APPROVE === 'true';
  const post = storage.createPost({
    content: params.content,
    platform: params.platform,
    scheduledAt: new Date(params.scheduledAt),
    tags: params.tags,
    campaignId: params.campaignId,
    status: autoApprove ? 'scheduled' : 'draft',
  });
  storage.log(autoApprove ? 'SCHEDULED' : 'DRAFTED', post.platform, post.id);
  return post;
}

// ── APPROVE POST ───────────────────────────────────────────────
// Promotes a single draft to scheduled — the only real state transition
// this performs; calling it on an already-scheduled/published/failed post
// just re-sets it to 'scheduled', same as the original prototype's
// unconditional approve endpoint.
export function approvePost(storage: TrendPostStorage, postId: string): ScheduledPost | null {
  const post = storage.getPost(postId);
  if (!post) return null;
  storage.updatePostStatus(postId, 'scheduled');
  storage.log('APPROVED', post.platform, postId);
  return storage.getPost(postId);
}

// ── APPROVE ALL DRAFTS ────────────────────────────────────────────
export function approveAllDrafts(storage: TrendPostStorage): { approved: number } {
  const drafts = storage.listPosts({ status: 'draft' });
  for (const post of drafts) {
    storage.updatePostStatus(post.id, 'scheduled');
  }
  storage.log('APPROVED_ALL', undefined, undefined, `${drafts.length} draft(s)`);
  return { approved: drafts.length };
}

// ── LIST SCHEDULED POSTS ───────────────────────────────────────
export function listPosts(
  storage: TrendPostStorage,
  params: {
    status?: string;
    platform?: Platform;
    daysAhead?: number;
    daysAgo?: number;
    dueOnly?: boolean;
  }
): ScheduledPost[] {
  const { status, platform, daysAhead, daysAgo, dueOnly } = params;
  const now = new Date();

  // dueOnly asks for "scheduled at or before now" — that means omitting the
  // `from` bound entirely, not passing `from: now, to: now` (which
  // storage.listPosts() would treat as an empty from-now-to-now window).
  if (dueOnly) {
    return storage.listPosts({ status: status as PostStatus | undefined, platform, to: now });
  }

  // daysAgo looks backward (for a retro over recently-published posts) —
  // mutually exclusive with daysAhead's forward-looking window, since a
  // caller wants one direction or the other, never both.
  if (daysAgo) {
    const from = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    return storage.listPosts({ status: status as PostStatus | undefined, platform, from, to: now });
  }

  const to = daysAhead ? new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000) : undefined;
  return storage.listPosts({ status: status as PostStatus | undefined, platform, from: now, to });
}

// ── DELETE POST ──────────────────────────────────────────────────
export function deletePost(storage: TrendPostStorage, postId: string): void {
  storage.deletePost(postId);
}

// ── LIST IDEAS ─────────────────────────────────────────────────────
export function listIdeas(storage: TrendPostStorage, status?: string): ContentIdea[] {
  return storage.listIdeas(status);
}

// ── ANALYZE CONTENT ─────────────────────────────────────────────────
export async function analyzeContent(params: {
  content: string;
  platform: Platform;
}): Promise<unknown> {
  const { content, platform } = params;

  const prompt = `Analyze this ${platform} post and return JSON:
{
  "score": 1-10,
  "strengths": ["..."],
  "improvements": ["..."],
  "estimatedEngagement": "low",
  "suggestion": "one specific rewrite suggestion"
}

Score against this rubric, not gut feel:
- 1-3: generic — could have been written for any business in this industry
- 4-6: solid but not distinctive — no reason someone stops scrolling for it
- 7-8: specific and platform-native — a real hook, a real detail, fits the platform's format
- 9-10: exceptional — the kind of post that gets screenshotted or replied to unprompted
"suggestion" must name the specific weak line/word and what to replace it with, not
generic advice like "make it more engaging."

POST:
${content}

Return only valid JSON. No markdown fences.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: CONTENT_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  return parseJson(raw, 'analyzeContent');
}
