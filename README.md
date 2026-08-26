# TrendPost

> AI content generation, scheduling, and multi-platform publishing — self-hosted, standalone.

TrendPost generates platform-native social posts with Claude, schedules
them, and publishes them to Twitter/X, LinkedIn, Facebook, and Instagram via
their official APIs — on full autopilot if you want it, or one post at a
time. It's a single service you run yourself: one Node process, one SQLite
file, no external dependencies.

## Quick start

**Docker (recommended):**

```bash
git clone https://github.com/tbmobb813/trendpost.git
cd trendpost
cp .env.example .env
# Fill in at least ANTHROPIC_API_KEY — see docs/DEPLOYMENT.md for platform credentials
docker compose up -d
curl http://localhost:3000/health
```

Then open `http://localhost:3000/` for the dashboard.

**Node.js:**

```bash
npm install
cp .env.example .env
npm run build
npm start
```

The scheduler starts automatically alongside the API — it sweeps for due
posts every 5 minutes (configurable) and publishes them. No cron setup
required.

## Capabilities

- **AI content generation** — Claude writes platform-native posts: Twitter
  threads, LinkedIn essays, Instagram captions, Facebook posts, each
  formatted for the platform (`src/content.ts`).
- **Content plans** — generate a batch of on-brand post ideas spread across
  a date range, or turn an existing launch timeline into a dated content
  calendar, no LLM call needed for the latter.
- **Content repurposing** — turn a blog post URL, a YouTube video, or
  pasted text into ready-to-schedule posts across your platforms, instead
  of hand-typing a topic every time. See below for the YouTube caveat.
- **4-platform publishing** — native API integrations, no middleware:
  Twitter v2, LinkedIn UGC Posts, Meta Graph API (`src/publishers/`).
- **Built-in scheduler** — an in-process interval loop publishes due posts
  automatically; a failed publish lands in `status: failed` with a
  diagnostic error rather than retrying blindly or silently dropping it.
  Only `scheduled` posts are swept — `draft` posts are never auto-published.
- **Draft → approve workflow** — controlled by `AUTO_APPROVE` in `.env`.
  When `false` (the default), newly scheduled posts land as `draft` and
  need an explicit approve before the scheduler will touch them
  (`POST /api/posts/:id/approve` or `.../approve-all`). Set `AUTO_APPROVE=true`
  to skip review and have new posts go straight to `scheduled`.
- **Twitter/X threads** — content containing a `\n\n---\n\n` separator
  publishes as a reply-chain thread instead of a single tweet.
- **Audit log** — every generate/schedule/approve/publish event is recorded
  independently of post state (`GET /api/logs`), so history survives even
  after a post is deleted.
- **REST API** — every feature accessible over HTTP; see routes below.
- **SQLite storage** — one file, zero external database, `draft → scheduled
  → published/failed` state machine.
- **Docker-first** — one command to deploy, runs on any small VPS.

## API

| Route | Purpose |
|---|---|
| `POST /api/content/generate` | Generate a single post for a topic/platform |
| `POST /api/content/plan` | Generate a batch of content ideas via Claude |
| `POST /api/content/plan-from-timeline` | Turn a launch timeline into dated content ideas (no LLM call) |
| `POST /api/content/analyze` | Score a post draft and suggest a specific rewrite |
| `POST /api/repurpose` | Turn a blog URL, YouTube video, or pasted text into ready platform posts — see Content repurposing below |
| `POST /api/campaigns` / `GET /api/campaigns` | Create / list campaigns |
| `POST /api/posts` / `GET /api/posts` | Schedule / list posts (`status`, `platform`, `daysAhead`, `daysAgo`, `dueOnly` filters; `autoApprove` body field overrides the `.env` default per-call) |
| `DELETE /api/posts/:id` | Delete a scheduled post |
| `POST /api/posts/:id/approve` | Promote a single draft to scheduled |
| `POST /api/posts/approve-all` | Promote every draft to scheduled |
| `POST /api/posts/:id/publish` | Publish a post immediately |
| `POST /api/posts/:id/mark-published` | Self-report a post published outside this system |
| `GET /api/ideas` | List generated content ideas |
| `GET /api/stats` | Post counts by status (`draft`/`scheduled`/`published`/`failed`) plus total |
| `GET /api/logs` | Recent audit log entries (`?limit=`) |
| `POST /api/tasks/publish-due-posts` | Manually trigger the same sweep the scheduler runs automatically |
| `POST /api/verify/{anthropic,twitter,linkedin,facebook,instagram}` | Stateless credential check — makes one live call to the platform, never persists what you send it |
| `GET /health` | Health check |

## Content repurposing

`POST /api/repurpose` (also available from the dashboard's Repurpose tab) turns
existing long-form material into posts:

```json
{ "sourceType": "url", "source": "https://example.com/blog/post", "platforms": ["twitter", "linkedin"], "postsCount": 5 }
```

`sourceType` is one of:
- `"url"` — fetches the page and extracts the main article text (`@mozilla/readability`).
- `"youtube"` — fetches the video's transcript via [yt-dlp](https://github.com/yt-dlp/yt-dlp)
  (see **System requirements** below — this needs `yt-dlp` and `deno` installed).
  There is no official API for captions on a video you don't own; yt-dlp is
  actively maintained and far more reliable than scraping YouTube's page
  HTML directly, but it can still fail (private/age-restricted videos,
  captions genuinely disabled). If it fails, resubmit with
  `sourceType: "text"` and the transcript pasted manually.
- `"text"` — the `source` string is used directly, no extraction — the
  manual fallback for both of the above.

### System requirements for YouTube repurposing

`sourceType: "youtube"` shells out to two external binaries — already
installed in the Docker image, but required separately for a bare
Node.js install:

- **yt-dlp** — `pip install yt-dlp`, or download the standalone binary
  from [its releases page](https://github.com/yt-dlp/yt-dlp/releases/latest).
- **Deno** — required alongside yt-dlp; recent YouTube extraction needs a
  JS runtime to execute player-response decryption, and yt-dlp silently
  returns incomplete results without one. Install via
  [deno.land/install.sh](https://deno.land/install.sh) or your package
  manager.

If `yt-dlp` isn't on `PATH`, `sourceType: "youtube"` requests fail with a
clear "yt-dlp is not installed" error rather than a crash — `sourceType: "url"`
and `"text"` are unaffected either way.

Long sources (a full-episode transcript) get condensed via a chunk-summarize
pass before post generation, so requests against long sources can take
10–40 seconds. Generated posts land as `draft` or `scheduled` following the
same `AUTO_APPROVE` rule as everything else, tagged to a new campaign.

PDF upload is not supported yet.

## Configuration

All configuration lives in `.env` — see `.env.example` for the full list
(Anthropic key, platform credentials, `PORT`, `DATABASE_PATH`,
`PUBLISH_CHECK_INTERVAL_MS`, and `BRAND_NAME`/`PRODUCT_NAME`/`BRAND_VOICE`
defaults used when a content-generation request doesn't supply its own
business context).

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the full deployment guide,
including how to get API credentials for each platform.

### API authentication

Every `/api/*` route (not `/health`, not the static dashboard files) can be
gated behind a bearer token. Set `API_KEY` in `.env` — generate one with
`openssl rand -hex 32` — and requests must send
`Authorization: Bearer <API_KEY>`.

If `API_KEY` is unset, the API runs unauthenticated and logs a loud warning
on startup. This keeps the zero-config `clone → npm install → npm start`
flow working for local/trusted-network use, but it means **anyone who can
reach the server can read/delete your data and spend your Anthropic
budget**. Set `API_KEY` before exposing this server beyond localhost or a
private network (Tailscale/SSH tunnel) — see
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

The dashboard and setup wizard prompt for the key in the browser on first
use (a `401` triggers the prompt) and store it in `localStorage`.

### Rate limiting

`/api/content/generate`, `/api/content/plan`, `/api/content/analyze`, and
`/api/repurpose` share a single request budget (`ANTHROPIC_RATE_LIMIT_MAX`
requests per `ANTHROPIC_RATE_LIMIT_WINDOW_MIN` minutes, default 30 per 10
minutes — see `.env.example`) so a leaked `API_KEY` or a buggy client retry
loop can't run away with your Anthropic bill. Exceeding it returns `429`
with a `Retry-After` header. The limit is process-wide, not per-caller, and
resets on restart.

## Development

```bash
npm install
npm run typecheck
npm test
npm run dev   # runs src/server.ts directly with hot reload
```

## Dashboard

A dashboard ships at `/` — Dashboard, Generate, Queue, Activity, and
Settings tabs, all wired to the REST API above (no separate frontend
build step; it's a static page served by the same process). Activity
shows real post/idea/campaign counts only — TrendPost doesn't ingest
platform engagement or reach data, so there are no fabricated
engagement-rate charts. Settings is read-only (edit `.env` and restart
to change brand voice or scheduling).

A setup wizard ships at `/setup.html` (linked from the dashboard's
Settings tab) — walks through Anthropic + each platform's credentials,
tests each one against the real API (`POST /api/verify/*`, stateless —
nothing is logged or saved server-side), and generates a `.env` block
to copy into your own `.env` file.
