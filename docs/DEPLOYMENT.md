# Deploying TrendPost

TrendPost is a single self-contained service: a REST API plus an in-process
scheduler, backed by one SQLite file. No external database, no other
services required.

## 1. Configure `.env`

```bash
cp .env.example .env
chmod 600 .env
```

At minimum, set `ANTHROPIC_API_KEY`. Add platform credentials for whichever
networks you want to auto-publish to (see below) — a scheduled post for a
platform with no credentials configured will fail with a clear "missing
credential" error rather than blocking publishing to the others.

**Note:** `docker compose restart` does **not** re-read `.env` — after
editing it, run `docker compose up -d` instead so the container picks up the
new values.

**Also set `API_KEY`** (generate with `openssl rand -hex 32`) before this
server is reachable from anywhere other than localhost. Without it, every
`/api/*` route is unauthenticated — anyone who can reach the server can
read/delete your data and spend your Anthropic budget. TrendPost will still
start and run fine with `API_KEY` unset (it logs a startup warning), which
is fine for purely local use, but is not safe on a shared network or the
open internet. With `API_KEY` set, requests to `/api/*` need
`Authorization: Bearer <API_KEY>`; the dashboard and setup wizard handle
this automatically by prompting for the key in the browser and storing it
in `localStorage`. `/health` and the static dashboard assets stay
unauthenticated (needed for Docker's healthcheck and for the page shell to
load before it can prompt for the key).

The primary control here is still network isolation — put TrendPost behind
Tailscale or an SSH tunnel rather than exposing port 3000 directly; `API_KEY`
is defense-in-depth, not a substitute for that.

## 2. Run it

**Docker (recommended):**

```bash
docker compose up -d
curl http://localhost:3000/health
```

**Node.js directly:**

```bash
npm install
npm run build
npm start
```

If you'll use YouTube content repurposing (`sourceType: "youtube"` on
`POST /api/repurpose`) outside Docker, install `yt-dlp` and `deno` on the
host first — both are already bundled in the Docker image, but a bare
Node.js install needs them separately:

```bash
pip install yt-dlp   # or download the standalone binary from its releases page
curl -fsSL https://deno.land/install.sh | sh
```

Without them, everything else works normally — only `sourceType: "youtube"`
requests fail, with a clear "yt-dlp is not installed" error rather than a
crash. `sourceType: "url"` and `"text"` don't need either binary.

The scheduler starts automatically with the server — no separate cron job
needed. It sweeps for due posts every `PUBLISH_CHECK_INTERVAL_MS` (default 5
minutes) and publishes each one via the credentials configured below. A post
that fails to publish (bad credentials, a platform API error) lands in
`status: 'failed'` with a diagnostic `errorMessage` and is **not** retried
automatically — check `GET /api/posts?status=failed` and intervene manually.

**Before relying on it unattended**, schedule a real test post
(`POST /api/posts` with `scheduledAt` a minute in the future) and confirm it
actually publishes and flips to `published` — ideally against a
throwaway/test account on each platform first, since neither Twitter nor
LinkedIn offer a real sandbox for posting (Meta does — see below).

## 3. Getting platform API credentials

**Twitter / X**

1. Go to [developer.twitter.com](https://developer.twitter.com/en/portal/dashboard),
   create a project and app.
2. Set app permissions to **Read + Write**.
3. Generate Access Token & Secret under "Keys and Tokens".
4. Copy all four values (`TWITTER_API_KEY`, `TWITTER_API_SECRET`,
   `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_SECRET`) to `.env`.

> ⚠️ Free tier = 500 tweets/month. At more than ~16 posts/day sustained,
> you'll need a paid tier.

**LinkedIn**

1. Create an app at [linkedin.com/developers/apps](https://www.linkedin.com/developers/apps).
2. Request the `w_member_social` permission.
3. Complete the OAuth 2.0 flow to get `LINKEDIN_ACCESS_TOKEN`.
4. Find your Person URN: `GET https://api.linkedin.com/v2/me` → copy the
   `id` field as `LINKEDIN_PERSON_URN` (with or without the
   `urn:li:person:` prefix — either works).

> ⚠️ LinkedIn access tokens expire every 60 days. Set a calendar reminder
> to refresh `LINKEDIN_ACCESS_TOKEN`, or publish attempts will start
> failing with an auth error.

**Facebook + Instagram (Meta Graph API)**

1. Create an app at [developers.facebook.com](https://developers.facebook.com/apps),
   add the **Facebook Login** and **Instagram Graph API** products.
2. Get a Page Access Token with `pages_manage_posts` permission via Graph
   API Explorer — this is `META_ACCESS_TOKEN` (shared by both platforms).
3. Find your Facebook Page ID (Page → About → Page ID) as `FACEBOOK_PAGE_ID`.
4. Find your Instagram Business Account ID in Meta Business Suite →
   Settings as `INSTAGRAM_ACCOUNT_ID`.
5. Set `INSTAGRAM_DEFAULT_IMAGE_URL` to a publicly accessible branded
   graphic (1080×1080px recommended) — Instagram feed posts require an
   image, and there's no way to post text-only.

> ℹ️ Meta offers a genuine sandbox for testing: create a Facebook **Test
> App** (a separate App ID in the same Meta Developer account) plus a Test
> Page/Test Instagram Business Account, and mint a short-lived test token
> via Graph API Explorer — verify a real publish there before ever using
> production credentials.

Full variable list: `TWITTER_API_KEY`, `TWITTER_API_SECRET`,
`TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_SECRET`, `LINKEDIN_ACCESS_TOKEN`,
`LINKEDIN_PERSON_URN`, `META_ACCESS_TOKEN`, `FACEBOOK_PAGE_ID`,
`INSTAGRAM_ACCOUNT_ID`, `INSTAGRAM_DEFAULT_IMAGE_URL`. You don't need all of
them — only add credentials for the platforms you actually plan to
auto-publish to.

## 4. Reverse proxy / TLS (optional)

TrendPost listens on plain HTTP on `PORT` (default 3000) with no built-in
TLS. If exposing it beyond localhost, put a reverse proxy (Caddy, nginx, or
a Tailscale-only bind) in front rather than publishing port 3000 directly to
the internet.

## 5. Backups

The entire application state is one SQLite file at `DATABASE_PATH`
(`/data/trendpost.db` under the Docker volume `trendpost-data`). Back that
one file up on whatever schedule matters to you — there's no other state to
capture.
