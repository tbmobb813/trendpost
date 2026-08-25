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

// extractYoutubeTranscript now shells out to the real yt-dlp binary via
// child_process.execFile (wrapped in util.promisify). Mocking execFile lets
// these tests run without yt-dlp installed in CI — the mock simulates the
// one real side effect the code depends on (a .vtt file appearing in the
// temp dir yt-dlp was told to write to via -o) rather than trying to fake
// promisify's internals.
jest.mock('child_process', () => ({ execFile: jest.fn() }));

import { execFile } from 'child_process';
import { writeFileSync } from 'fs';
import { Readability } from '@mozilla/readability';
import { extractFromUrl, extractYoutubeTranscript, NoCaptionsError } from '../extract';

type ExecFileCallback = (error: NodeJS.ErrnoException | null, result?: { stdout: string; stderr: string }) => void;

function mockYtDlp(result: { stdout: string; vtt?: string } | NodeJS.ErrnoException) {
  (execFile as unknown as jest.Mock).mockImplementation((...callArgs: unknown[]) => {
    const args = callArgs[1] as string[];
    const callback = callArgs[callArgs.length - 1] as ExecFileCallback;

    if (result instanceof Error) {
      callback(result as NodeJS.ErrnoException);
      return;
    }

    if (result.vtt !== undefined) {
      const oIndex = args.indexOf('-o');
      const template = args[oIndex + 1]; // e.g. /tmp/trendpost-yt-xxxx/%(id)s
      const dir = template.slice(0, template.lastIndexOf('/'));
      writeFileSync(`${dir}/video.en.vtt`, result.vtt);
    }
    callback(null, { stdout: result.stdout, stderr: '' });
  });
}

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
  afterEach(() => jest.clearAllMocks());

  it('extracts and de-duplicates transcript text from the .vtt file yt-dlp writes', async () => {
    const vtt = `WEBVTT
Kind: captions
Language: en

00:00:00.000 --> 00:00:02.000
Hello there

00:00:02.000 --> 00:00:04.000
Hello there

00:00:04.000 --> 00:00:06.000
this is a test video transcript with enough content to pass the length check repeated several times over.`;
    mockYtDlp({ stdout: 'Test Video Title\n', vtt });

    const result = await extractYoutubeTranscript('https://www.youtube.com/watch?v=abcdefghijk');

    expect(result.title).toBe('Test Video Title');
    // "Hello there" appears twice consecutively in the raw VTT (a real
    // rolling-caption artifact) — parseVtt should collapse it to once.
    expect(result.text.match(/Hello there/g)).toHaveLength(1);
    expect(result.text).toContain('test video transcript');
  });

  it('parses video IDs from youtu.be short links', async () => {
    mockYtDlp({ stdout: 'Title\n', vtt: `WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n${'content '.repeat(30)}` });

    const result = await extractYoutubeTranscript('https://youtu.be/abcdefghijk');
    expect(result.text.length).toBeGreaterThan(50);
  });

  it('throws NoCaptionsError when yt-dlp writes no .vtt file (video has no captions)', async () => {
    mockYtDlp({ stdout: 'Captionless Video\n' }); // no vtt field — nothing written
    await expect(extractYoutubeTranscript('https://www.youtube.com/watch?v=abcdefghijk')).rejects.toThrow(
      NoCaptionsError
    );
  });

  it('throws a plain error when the URL has no parseable video ID', async () => {
    await expect(extractYoutubeTranscript('https://example.com/not-youtube')).rejects.toThrow(
      /Could not parse a YouTube video ID/
    );
  });

  it('throws a clear, distinguishable error when yt-dlp is not installed (ENOENT)', async () => {
    const enoent = Object.assign(new Error('spawn yt-dlp ENOENT'), { code: 'ENOENT' });
    mockYtDlp(enoent);

    await expect(extractYoutubeTranscript('https://www.youtube.com/watch?v=abcdefghijk')).rejects.toThrow(
      /yt-dlp is not installed/
    );
  });

  it('wraps a non-ENOENT yt-dlp failure (e.g. video removed/private) into a clear error', async () => {
    mockYtDlp(new Error('ERROR: Video unavailable') as NodeJS.ErrnoException);

    await expect(extractYoutubeTranscript('https://www.youtube.com/watch?v=abcdefghijk')).rejects.toThrow(
      /yt-dlp failed/
    );
  });
});
