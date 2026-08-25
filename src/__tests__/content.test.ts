jest.mock('../publishers', () => ({ publishToPlatform: jest.fn() }));

// See condense.test.ts for why this goes through a global instead of a
// closed-over const — content.ts constructs its Anthropic client at module
// load time, before a normally-declared outer const would be assigned.
jest.mock('@anthropic-ai/sdk', () => {
  const create = jest.fn();
  (globalThis as Record<string, unknown>).__anthropicMockCreate = create;
  return jest.fn().mockImplementation(() => ({ messages: { create } }));
});

import { existsSync, unlinkSync } from 'fs';
import {
  distributeDates,
  timelineWeekNumber,
  listPosts,
  publishPost,
  schedulePost,
  approvePost,
  approveAllDrafts,
  generateFromSource,
  validatePlatformConstraints,
} from '../content';
import { TrendPostStorage } from '../storage';
import { publishToPlatform } from '../publishers';

const mockAnthropicCreate = (globalThis as Record<string, unknown>).__anthropicMockCreate as jest.Mock;

const TEST_DB = './test-trendpost-content.db';
const mockPublishToPlatform = publishToPlatform as jest.Mock;

describe('distributeDates()', () => {
  it('returns an empty array for count <= 0', () => {
    expect(distributeDates(0, 1)).toEqual([]);
    expect(distributeDates(-1, 1)).toEqual([]);
  });

  it('spreads count items evenly across the weeksAhead*7-day window', () => {
    const from = new Date('2026-06-01T00:00:00Z');
    const dates = distributeDates(3, 1, from);
    expect(dates).toHaveLength(3);
    // Window is 7 days starting tomorrow (2026-06-02); 3 items step ~2.33 days apart.
    expect(dates[0].getUTCDate()).toBe(2);
    expect(dates[1].getUTCDate()).toBeGreaterThan(dates[0].getUTCDate());
    expect(dates[2].getUTCDate()).toBeGreaterThan(dates[1].getUTCDate());
  });

  it('starts strictly after "from" (never schedules for today)', () => {
    const from = new Date('2026-06-01T15:00:00Z');
    const [first] = distributeDates(1, 1, from);
    expect(first.getTime()).toBeGreaterThan(from.getTime());
  });

  it('produces dates in ascending order', () => {
    const dates = distributeDates(5, 2, new Date('2026-06-01T00:00:00Z'));
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i].getTime()).toBeGreaterThanOrEqual(dates[i - 1].getTime());
    }
  });
});

describe('timelineWeekNumber()', () => {
  it('parses a leading integer from the label', () => {
    expect(timelineWeekNumber('Week 1', 0)).toBe(1);
    expect(timelineWeekNumber('Week 2: Launch', 0)).toBe(2);
  });

  it('falls back to the 1-indexed position when the label has no number', () => {
    expect(timelineWeekNumber('Pre-launch', 0)).toBe(1);
    expect(timelineWeekNumber('Pre-launch', 2)).toBe(3);
  });
});

describe('listPosts() — dueOnly', () => {
  function freshStorage() {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    return new TrendPostStorage(TEST_DB);
  }

  afterEach(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  it('returns only scheduled posts at or before now, regardless of daysAhead', () => {
    const storage = freshStorage();
    const past = storage.createPost({
      content: 'due',
      platform: 'twitter',
      scheduledAt: new Date(Date.now() - 60_000),
    });
    storage.createPost({
      content: 'future',
      platform: 'twitter',
      scheduledAt: new Date(Date.now() + 60 * 60_000),
    });

    const due = listPosts(storage, { status: 'scheduled', dueOnly: true });

    expect(due.map((p) => p.id)).toEqual([past.id]);
  });

  it('without dueOnly, keeps the existing from-now-forward behavior', () => {
    const storage = freshStorage();
    storage.createPost({
      content: 'past',
      platform: 'twitter',
      scheduledAt: new Date(Date.now() - 60_000),
    });
    const future = storage.createPost({
      content: 'future',
      platform: 'twitter',
      scheduledAt: new Date(Date.now() + 60 * 60_000),
    });

    const upcoming = listPosts(storage, { status: 'scheduled' });

    expect(upcoming.map((p) => p.id)).toEqual([future.id]);
  });

  it('daysAgo returns only posts scheduled within the backward-looking window', () => {
    const storage = freshStorage();
    const recent = storage.createPost({
      content: 'recent',
      platform: 'twitter',
      scheduledAt: new Date(Date.now() - 2 * 24 * 60 * 60_000),
    });
    storage.createPost({
      content: 'too old',
      platform: 'twitter',
      scheduledAt: new Date(Date.now() - 10 * 24 * 60 * 60_000),
    });
    storage.createPost({
      content: 'future',
      platform: 'twitter',
      scheduledAt: new Date(Date.now() + 60 * 60_000),
    });

    const withinWindow = listPosts(storage, { daysAgo: 5 });

    expect(withinWindow.map((p) => p.id)).toEqual([recent.id]);
  });
});

describe('publishPost()', () => {
  function freshStorage() {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    return new TrendPostStorage(TEST_DB);
  }

  beforeEach(() => {
    mockPublishToPlatform.mockReset();
  });

  afterEach(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  it('publishes successfully: sets status published and stores the platformPostId', async () => {
    const storage = freshStorage();
    const post = storage.createPost({
      content: 'hi',
      platform: 'twitter',
      scheduledAt: new Date(),
    });
    mockPublishToPlatform.mockResolvedValue({ platformPostId: 'tw-1' });

    const result = await publishPost(storage, post.id);

    expect(mockPublishToPlatform).toHaveBeenCalledWith('twitter', 'hi');
    expect(result.status).toBe('published');
    expect(result.platformPostId).toBe('tw-1');
  });

  it('on publisher failure, sets status failed with the error message instead of throwing', async () => {
    const storage = freshStorage();
    const post = storage.createPost({
      content: 'hi',
      platform: 'instagram',
      scheduledAt: new Date(),
    });
    mockPublishToPlatform.mockRejectedValue(new Error('missing INSTAGRAM_DEFAULT_IMAGE_URL'));

    const result = await publishPost(storage, post.id);

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBe('missing INSTAGRAM_DEFAULT_IMAGE_URL');
  });

  it('throws for an unknown postId', async () => {
    const storage = freshStorage();
    await expect(publishPost(storage, 'nope')).rejects.toThrow(/No post found/);
  });
});

describe('schedulePost() — autoApprove / AUTO_APPROVE default', () => {
  const TEST_DB2 = './test-trendpost-content-schedule.db';
  const originalEnv = { ...process.env };

  function fresh() {
    if (existsSync(TEST_DB2)) unlinkSync(TEST_DB2);
    return new TrendPostStorage(TEST_DB2);
  }

  afterEach(() => {
    if (existsSync(TEST_DB2)) unlinkSync(TEST_DB2);
    process.env = { ...originalEnv };
  });

  it('creates a draft by default when AUTO_APPROVE is unset', () => {
    delete process.env.AUTO_APPROVE;
    const storage = fresh();
    const post = schedulePost(storage, {
      content: 'hi',
      platform: 'twitter',
      scheduledAt: new Date().toISOString(),
    });
    expect(post.status).toBe('draft');
  });

  it('creates a scheduled post when AUTO_APPROVE=true', () => {
    process.env.AUTO_APPROVE = 'true';
    const storage = fresh();
    const post = schedulePost(storage, {
      content: 'hi',
      platform: 'twitter',
      scheduledAt: new Date().toISOString(),
    });
    expect(post.status).toBe('scheduled');
  });

  it('an explicit autoApprove param overrides the env default', () => {
    delete process.env.AUTO_APPROVE;
    const storage = fresh();
    const post = schedulePost(storage, {
      content: 'hi',
      platform: 'twitter',
      scheduledAt: new Date().toISOString(),
      autoApprove: true,
    });
    expect(post.status).toBe('scheduled');
  });
});

describe('approvePost()', () => {
  const TEST_DB3 = './test-trendpost-content-approve.db';
  function fresh() {
    if (existsSync(TEST_DB3)) unlinkSync(TEST_DB3);
    return new TrendPostStorage(TEST_DB3);
  }
  afterEach(() => {
    if (existsSync(TEST_DB3)) unlinkSync(TEST_DB3);
  });

  it('promotes a draft to scheduled', () => {
    const storage = fresh();
    const draft = storage.createPost({
      content: 'x',
      platform: 'twitter',
      scheduledAt: new Date(),
      status: 'draft',
    });
    const approved = approvePost(storage, draft.id);
    expect(approved!.status).toBe('scheduled');
  });

  it('returns null for an unknown postId', () => {
    const storage = fresh();
    expect(approvePost(storage, 'nope')).toBeNull();
  });
});

describe('approveAllDrafts()', () => {
  const TEST_DB4 = './test-trendpost-content-approve-all.db';
  function fresh() {
    if (existsSync(TEST_DB4)) unlinkSync(TEST_DB4);
    return new TrendPostStorage(TEST_DB4);
  }
  afterEach(() => {
    if (existsSync(TEST_DB4)) unlinkSync(TEST_DB4);
  });

  it('approves every draft and leaves non-drafts untouched, returning the count', () => {
    const storage = fresh();
    storage.createPost({ content: 'a', platform: 'twitter', scheduledAt: new Date(), status: 'draft' });
    storage.createPost({ content: 'b', platform: 'twitter', scheduledAt: new Date(), status: 'draft' });
    const alreadyScheduled = storage.createPost({
      content: 'c',
      platform: 'twitter',
      scheduledAt: new Date(),
    });

    const result = approveAllDrafts(storage);

    expect(result).toEqual({ approved: 2 });
    expect(storage.listPosts({ status: 'draft' })).toHaveLength(0);
    expect(storage.listPosts({ status: 'scheduled' })).toHaveLength(3);
    expect(storage.getPost(alreadyScheduled.id)!.status).toBe('scheduled');
  });

  it('returns 0 when there are no drafts', () => {
    const storage = fresh();
    expect(approveAllDrafts(storage)).toEqual({ approved: 0 });
  });
});

describe('generateFromSource()', () => {
  const TEST_DB5 = './test-trendpost-content-repurpose.db';
  function fresh() {
    if (existsSync(TEST_DB5)) unlinkSync(TEST_DB5);
    return new TrendPostStorage(TEST_DB5);
  }
  afterEach(() => {
    if (existsSync(TEST_DB5)) unlinkSync(TEST_DB5);
    mockAnthropicCreate.mockReset();
  });

  const longSourceText = 'This is real source content about a specific topic. '.repeat(10);

  function textResponse(text: string) {
    return { content: [{ type: 'text', text }] };
  }

  const briefJson = JSON.stringify({
    mainThesis: 'The source makes one clear point.',
    keyClaims: ['Claim one', 'Claim two'],
    tone: 'direct',
    quotableMoments: ['A striking line from the source'],
  });

  it('extracts a brief first, then generates posts from it (two sequential LLM calls)', async () => {
    const storage = fresh();
    mockAnthropicCreate
      .mockResolvedValueOnce(textResponse(briefJson))
      .mockResolvedValueOnce(
        textResponse(
          JSON.stringify([
            { content: 'Post one from the source', platform: 'twitter' },
            { content: 'Post two from the source', platform: 'linkedin' },
          ])
        )
      );

    const result = await generateFromSource(storage, {
      sourceTitle: 'My Source',
      sourceText: longSourceText,
      platforms: ['twitter', 'linkedin'],
    });

    expect(mockAnthropicCreate).toHaveBeenCalledTimes(2);
    expect(result.campaign.source).toBe('repurpose');
    expect(result.campaign.name).toBe('My Source');
    expect(result.posts).toHaveLength(2);
    expect(result.posts.every((p) => p.status === 'draft')).toBe(true);
    expect(result.posts.every((p) => p.campaignId === result.campaign.id)).toBe(true);
    expect(result.posts.map((p) => p.content)).toEqual([
      'Post one from the source',
      'Post two from the source',
    ]);
  });

  it('schedules immediately when autoApprove is true', async () => {
    const storage = fresh();
    mockAnthropicCreate
      .mockResolvedValueOnce(textResponse(briefJson))
      .mockResolvedValueOnce(textResponse(JSON.stringify([{ content: 'x', platform: 'twitter' }])));

    const result = await generateFromSource(storage, {
      sourceText: longSourceText,
      platforms: ['twitter'],
      autoApprove: true,
    });

    expect(result.posts[0].status).toBe('scheduled');
  });

  it('rejects source text under 200 characters without calling the LLM', async () => {
    const storage = fresh();
    await expect(
      generateFromSource(storage, { sourceText: 'too short', platforms: ['twitter'] })
    ).rejects.toThrow(/too short to repurpose/);
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
  });

  it('regenerates once when a post violates a hard platform constraint (tweet over 280 chars)', async () => {
    const storage = fresh();
    const tooLong = 'x'.repeat(300);
    const fixed = 'A properly short tweet.';
    mockAnthropicCreate
      .mockResolvedValueOnce(textResponse(briefJson)) // brief
      .mockResolvedValueOnce(textResponse(JSON.stringify([{ content: tooLong, platform: 'twitter' }]))) // initial (violates)
      .mockResolvedValueOnce(textResponse(fixed)); // regenerated (plain text, not JSON)

    const result = await generateFromSource(storage, {
      sourceText: longSourceText,
      platforms: ['twitter'],
    });

    expect(mockAnthropicCreate).toHaveBeenCalledTimes(3);
    expect(result.posts[0].content).toBe(fixed);
  });

  it('does not regenerate when every post already satisfies its platform constraint', async () => {
    const storage = fresh();
    mockAnthropicCreate
      .mockResolvedValueOnce(textResponse(briefJson))
      .mockResolvedValueOnce(textResponse(JSON.stringify([{ content: 'short and fine', platform: 'twitter' }])));

    await generateFromSource(storage, { sourceText: longSourceText, platforms: ['twitter'] });

    expect(mockAnthropicCreate).toHaveBeenCalledTimes(2);
  });
});

describe('validatePlatformConstraints()', () => {
  it('flags a tweet over 280 chars', () => {
    expect(validatePlatformConstraints('x'.repeat(281), 'twitter')).toEqual({
      ok: false,
      reason: expect.stringContaining('280'),
    });
  });

  it('passes a tweet at or under 280 chars', () => {
    expect(validatePlatformConstraints('x'.repeat(280), 'twitter')).toEqual({ ok: true });
  });

  it('flags a linkedin post far past the word-count guideline', () => {
    const words = Array(401).fill('word').join(' ');
    expect(validatePlatformConstraints(words, 'linkedin').ok).toBe(false);
  });

  it('does not flag a short linkedin post — minimums are style guidance, not enforced', () => {
    expect(validatePlatformConstraints('Just a few words.', 'linkedin')).toEqual({ ok: true });
  });

  it('flags a facebook post far past its guideline and an instagram post far past its guideline', () => {
    const words = Array(301).fill('word').join(' ');
    expect(validatePlatformConstraints(words, 'facebook').ok).toBe(false);
    const igWords = Array(201).fill('word').join(' ');
    expect(validatePlatformConstraints(igWords, 'instagram').ok).toBe(false);
  });
});
