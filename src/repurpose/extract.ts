import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';

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

export async function extractFromUrl(url: string): Promise<ExtractedSource> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
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

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

// Scrapes YouTube's public (unofficial, undocumented) timedtext endpoint —
// the same technique third-party "youtube transcript" tools use. There is
// no official API for fetching captions on a video you don't own, so this
// is the only free option; it can break if YouTube changes its page
// structure, which is why NoCaptionsError exists as a distinct, expected
// failure mode rather than something the caller has to guess about from a
// generic error.
export async function extractYoutubeTranscript(url: string): Promise<ExtractedSource> {
  const videoId = parseYoutubeVideoId(url);

  const watchRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-US,en;q=0.9' },
  });
  if (!watchRes.ok) {
    throw new Error(`Failed to fetch YouTube watch page for ${videoId}: ${watchRes.status}`);
  }
  const html = await watchRes.text();

  const titleMatch = html.match(/"title":"((?:[^"\\]|\\.)*)"/);
  const title = titleMatch ? JSON.parse(`"${titleMatch[1]}"`) : videoId;

  const tracksMatch = html.match(/"captionTracks":(\[.*?\])/);
  if (!tracksMatch) throw new NoCaptionsError(videoId);

  let tracks: { baseUrl: string; languageCode: string }[];
  try {
    tracks = JSON.parse(tracksMatch[1]);
  } catch {
    throw new NoCaptionsError(videoId);
  }
  if (!tracks.length) throw new NoCaptionsError(videoId);

  // Prefer an English track if one exists, otherwise take whatever's first.
  const track = tracks.find((t) => t.languageCode?.startsWith('en')) ?? tracks[0];
  const captionUrl = track.baseUrl.replace(/\\u0026/g, '&');

  const captionRes = await fetch(captionUrl, { headers: { 'User-Agent': USER_AGENT } });
  if (!captionRes.ok) throw new NoCaptionsError(videoId);
  const xml = await captionRes.text();

  const lines = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) =>
    decodeXmlEntities(m[1]).replace(/\n/g, ' ').trim()
  );
  const text = lines.join(' ').replace(/\s+/g, ' ').trim();

  if (text.length < 100) throw new NoCaptionsError(videoId);

  return { title, text };
}
