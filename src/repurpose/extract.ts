import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { assertSafeToFetch } from './ssrf-guard';

const execFileAsync = promisify(execFile);

export interface ExtractedSource {
  title: string;
  text: string;
}

// Thrown specifically (not a generic Error) when a YouTube video has no
// caption track available — the route layer catches this by type to return
// a 422 pointing the caller at the manual-paste fallback, rather than a
// generic 500.
export class NoCaptionsError extends Error {
  constructor(videoId: string) {
    super(`No captions available for video ${videoId}. Paste the transcript manually instead (sourceType: "text").`);
    this.name = 'NoCaptionsError';
  }
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// fetch() follows redirects transparently, which would let a public-looking
// URL bounce to an internal address after the initial SSRF check passed —
// so redirects are followed manually here, re-checking each hop.
const MAX_REDIRECTS = 5;

async function fetchSafely(url: string): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertSafeToFetch(current);
    const res = await fetch(current, {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'manual',
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location')!, current).toString();
      continue;
    }
    return res;
  }
  throw new Error(`Too many redirects while fetching ${url}.`);
}

export async function extractFromUrl(url: string): Promise<ExtractedSource> {
  const res = await fetchSafely(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('html')) {
    throw new Error(`${url} did not return HTML content (got "${contentType}")`);
  }
  const html = await res.text();

  const dom = new JSDOM(html, { url });
  const article = new Readability(dom.window.document).parse();
  if (!article || !article.textContent || article.textContent.trim().length < 100) {
    throw new Error(
      `Could not extract article content from ${url} — it may be paywalled, JS-rendered, or not an article page.`
    );
  }

  return { title: article.title || url, text: article.textContent.trim() };
}

function parseYoutubeVideoId(url: string): string {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtube\.com\/shorts\/|youtu\.be\/)([\w-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  throw new Error(`Could not parse a YouTube video ID out of "${url}".`);
}

// Strips WEBVTT structure down to plain spoken text: the header, cue-timing
// lines, inline tags like <c> or <00:00:01.000>, and consecutive duplicate
// lines — YouTube's auto-caption VTT output repeats overlapping text across
// cues by design (a rolling-caption artifact, not a parsing bug), so naive
// concatenation would repeat every sentence 2-3 times.
function parseVtt(vtt: string): string {
  const lines = vtt
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && l !== 'WEBVTT' && !l.startsWith('Kind:') && !l.startsWith('Language:'))
    .filter((l) => !/^\d\d:\d\d:\d\d[.,]\d+ --> \d\d:\d\d:\d\d[.,]\d+/.test(l))
    .filter((l) => !/^\d+$/.test(l)) // bare cue-number lines
    .map((l) => l.replace(/<[^>]+>/g, '').trim())
    .filter(Boolean);

  const deduped: string[] = [];
  for (const line of lines) {
    if (deduped[deduped.length - 1] !== line) deduped.push(line);
  }
  return deduped.join(' ').replace(/\s+/g, ' ').trim();
}

// Uses yt-dlp (a system-level dependency — see docs/DEPLOYMENT.md) instead
// of scraping YouTube's page HTML directly. yt-dlp is actively maintained
// by a large community keeping pace with YouTube's changes, which our own
// hand-rolled scraper could not — verified in testing to successfully pull
// captions on a video our previous scraper reported as caption-less.
// --print forces yt-dlp into simulate mode unless --no-simulate is also
// passed, which would silently suppress the subtitle-writing side effect
// this depends on.
export async function extractYoutubeTranscript(url: string): Promise<ExtractedSource> {
  const videoId = parseYoutubeVideoId(url);
  const tempDir = mkdtempSync(join(tmpdir(), 'trendpost-yt-'));

  try {
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync('yt-dlp', [
        '--write-auto-subs',
        '--write-subs',
        '--sub-langs',
        'en',
        '--skip-download',
        '--no-simulate',
        '--print',
        'title',
        '-o',
        join(tempDir, '%(id)s'),
        '--',
        url,
      ]));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        throw new Error(
          'yt-dlp is not installed on this server. It is required for YouTube repurposing — ' +
            'see docs/DEPLOYMENT.md for install instructions, or use sourceType: "text" to paste a transcript manually.'
        );
      }
      throw new Error(
        `yt-dlp failed for ${videoId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    const title = stdout.trim() || videoId;
    const vttFile = readdirSync(tempDir).find((f) => f.endsWith('.vtt'));
    if (!vttFile) throw new NoCaptionsError(videoId);

    const text = parseVtt(readFileSync(join(tempDir, vttFile), 'utf8'));
    if (text.length < 100) throw new NoCaptionsError(videoId);

    return { title, text };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
