jest.mock('../publishers', () => ({ publishToPlatform: jest.fn() }));

import { existsSync, unlinkSync } from 'fs';
import { distributeDates, timelineWeekNumber, listPosts, publishPost } from '../content';
import { TrendPostStorage } from '../storage';
import { publishToPlatform } from '../publishers';

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
