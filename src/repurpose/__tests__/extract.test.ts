// jsdom's dependency tree goes several ESM layers deep (CSS parsing
// packages that don't transform cleanly under ts-jest/@swc-jest) — mocked
// out entirely rather than chased through transform config, the same way
// twitter.test.ts mocks twitter-api-v2 instead of hitting the real API.
// extract.ts constructs JSDOM/Readability lazily inside extractFromUrl(),
// not at module load time, so referencing these imported mocks directly
// from test bodies (rather than via closed-over factory variables) is
// safe — no hoisting-order hazard like content.ts's module-level client.
jest.mock('jsdom', () => ({
  JSDOM: jest.fn().mockImplementation(() => ({ window: { document: {} } })),
}));
jest.mock('@mozilla/readability', () => ({
  Readability: jest.fn().mockImplementation(() => ({ parse: jest.fn() })),
}));

import { Readability } from '@mozilla/readability';
import { extractFromUrl, extractYoutubeTranscript, NoCaptionsError } from '../extract';

function mockReadabilityResult(result: { title: string; textContent: string } | null) {
  (Readability as unknown as jest.Mock).mockImplementation(() => ({ parse: () => result }));
}

describe('extractFromUrl()', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('extracts the article title and text Readability returns', async () => {
    mockReadabilityResult({ title: 'How TrendPost Works', textContent: 'Real article content. '.repeat(20) });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html; charset=utf-8' },
      text: async () => '<html></html>',
    }) as unknown as typeof fetch;

    const result = await extractFromUrl('https://example.com/article');

    expect(result.title).toBe('How TrendPost Works');
    expect(result.text).toContain('Real article content.');
  });

  it('throws when the response is not ok', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: { get: () => 'text/html' },
    }) as unknown as typeof fetch;

    await expect(extractFromUrl('https://example.com/missing')).rejects.toThrow(/404/);
  });

  it('throws when the response is not HTML', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      text: async () => '{}',
    }) as unknown as typeof fetch;

    await expect(extractFromUrl('https://example.com/api')).rejects.toThrow(/did not return HTML/);
  });

  it('throws when Readability finds no substantial article content', async () => {
    mockReadabilityResult(null);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
      text: async () => '<html></html>',
    }) as unknown as typeof fetch;

    await expect(extractFromUrl('https://example.com/empty')).rejects.toThrow(/Could not extract/);
  });

  it('throws when Readability returns very short content', async () => {
    mockReadabilityResult({ title: 'Thin', textContent: 'too short' });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
      text: async () => '<html></html>',
    }) as unknown as typeof fetch;

    await expect(extractFromUrl('https://example.com/thin')).rejects.toThrow(/Could not extract/);
  });
});

describe('extractYoutubeTranscript()', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockWatchAndCaptions(captionXml: string | null) {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('/watch?v=')) {
        const tracks = captionXml
          ? '"captionTracks":[{"baseUrl":"https://caption.example/track","languageCode":"en"}]'
          : '';
        return Promise.resolve({
          ok: true,
          text: async () => `<html>"title":"Test Video Title"${tracks ? ',' + tracks : ''}</html>`,
        });
      }
      if (url === 'https://caption.example/track') {
        return Promise.resolve({ ok: true, text: async () => captionXml });
      }
      return Promise.resolve({ ok: false, status: 404, text: async () => '' });
    }) as unknown as typeof fetch;
  }

  it('extracts and concatenates transcript text from the caption track', async () => {
    const xml =
      '<transcript><text start="0" dur="2">Hello there</text><text start="2" dur="2">this is a test video transcript with enough content to pass the length check repeated several times over.</text></transcript>';
    mockWatchAndCaptions(xml);

    const result = await extractYoutubeTranscript('https://www.youtube.com/watch?v=abcdefghijk');

    expect(result.title).toBe('Test Video Title');
    expect(result.text).toContain('Hello there');
    expect(result.text).toContain('test video transcript');
  });

  it('parses video IDs from youtu.be short links', async () => {
    const xml = `<transcript><text>${'content '.repeat(30)}</text></transcript>`;
    mockWatchAndCaptions(xml);

    const result = await extractYoutubeTranscript('https://youtu.be/abcdefghijk');
    expect(result.text.length).toBeGreaterThan(50);
  });

  it('throws NoCaptionsError when no captionTracks are present', async () => {
    mockWatchAndCaptions(null);
    await expect(extractYoutubeTranscript('https://www.youtube.com/watch?v=abcdefghijk')).rejects.toThrow(
      NoCaptionsError
    );
  });

  it('throws a plain error when the URL has no parseable video ID', async () => {
    await expect(extractYoutubeTranscript('https://example.com/not-youtube')).rejects.toThrow(
      /Could not parse a YouTube video ID/
    );
  });
});
