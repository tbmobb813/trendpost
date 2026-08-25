// Mocks twitter-api-v2 at the module boundary — no live Twitter API
// available in CI.

const mockTweet = jest.fn();
jest.mock('twitter-api-v2', () => ({
  TwitterApi: jest.fn().mockImplementation(() => ({ v2: { tweet: mockTweet } })),
}));

import { TwitterApi } from 'twitter-api-v2';
import { postToTwitter } from '../twitter';

const ENV_VARS = [
  'TWITTER_API_KEY',
  'TWITTER_API_SECRET',
  'TWITTER_ACCESS_TOKEN',
  'TWITTER_ACCESS_SECRET',
];

describe('postToTwitter()', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TWITTER_API_KEY = 'key';
    process.env.TWITTER_API_SECRET = 'secret';
    process.env.TWITTER_ACCESS_TOKEN = 'token';
    process.env.TWITTER_ACCESS_SECRET = 'token-secret';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('constructs the client with the four env-var credentials', async () => {
    mockTweet.mockResolvedValue({ data: { id: 'tw-1', text: 'hi' } });

    await postToTwitter('hello world');

    expect(TwitterApi).toHaveBeenCalledWith({
      appKey: 'key',
      appSecret: 'secret',
      accessToken: 'token',
      accessSecret: 'token-secret',
    });
  });

  it('tweets the post content and maps the tweet id to platformPostId', async () => {
    mockTweet.mockResolvedValue({ data: { id: 'tw-42', text: 'hello world' } });

    const result = await postToTwitter('hello world');

    expect(mockTweet).toHaveBeenCalledWith('hello world');
    expect(result).toEqual({
      platformPostId: 'tw-42',
      url: 'https://twitter.com/i/web/status/tw-42',
    });
  });

  it.each(ENV_VARS)(
    'throws a clear error naming the missing credential when %s is unset',
    async (name) => {
      delete process.env[name];
      await expect(postToTwitter('hello')).rejects.toThrow(new RegExp(name));
      expect(mockTweet).not.toHaveBeenCalled();
    }
  );

  describe('thread posting (content separated by "\\n\\n---\\n\\n")', () => {
    it(
      'posts each part as a reply to the previous tweet and returns the full chain',
      async () => {
        mockTweet
          .mockResolvedValueOnce({ data: { id: 'tw-1' } })
          .mockResolvedValueOnce({ data: { id: 'tw-2' } })
          .mockResolvedValueOnce({ data: { id: 'tw-3' } });

        const result = await postToTwitter('First tweet\n\n---\n\nSecond tweet\n\n---\n\nThird tweet');

        expect(mockTweet).toHaveBeenCalledTimes(3);
        expect(mockTweet).toHaveBeenNthCalledWith(1, { text: 'First tweet' });
        expect(mockTweet).toHaveBeenNthCalledWith(2, {
          text: 'Second tweet',
          reply: { in_reply_to_tweet_id: 'tw-1' },
        });
        expect(mockTweet).toHaveBeenNthCalledWith(3, {
          text: 'Third tweet',
          reply: { in_reply_to_tweet_id: 'tw-2' },
        });
        expect(result).toEqual({
          platformPostId: 'tw-1',
          url: 'https://twitter.com/i/web/status/tw-1',
          threadIds: ['tw-1', 'tw-2', 'tw-3'],
        });
      },
      // Real (unmocked) 1s inter-tweet delay x2 between three chained
      // tweets — longer than jest's 5s default test timeout.
      10000
    );

    it('a single part (no delimiter) still posts as one plain tweet, no threadIds', async () => {
      mockTweet.mockResolvedValue({ data: { id: 'tw-solo' } });

      const result = await postToTwitter('Just one tweet');

      expect(mockTweet).toHaveBeenCalledTimes(1);
      expect(mockTweet).toHaveBeenCalledWith('Just one tweet');
      expect(result.threadIds).toBeUndefined();
    });
  });
});
