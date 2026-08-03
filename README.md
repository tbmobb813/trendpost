# TrendPost

> **AI-powered social media autopilot — self-hosted, open source, no credit limits.**

Post to Twitter/X, LinkedIn, Instagram, and Facebook on full autopilot. Claude generates platform-native content on a cron schedule, queues it for optional review, and publishes via official APIs — directly from your server.

No SaaS subscription. No credit limits. No vendor reading your content. Your stack, your rules.

---

![SynqPost Dashboard](https://placehold.co/900x480/0a0a0a/c8f564?text=SynqPost+Dashboard+Screenshot)
*Replace this with an actual dashboard screenshot before publishing*

---

## Why TrendPost

Most social media automation tools are SaaS products you rent forever. They cap your posts, read your content on their servers, and raise prices once you're dependent.

TrendPost is different:

| | SaaS tools (Blotato, Buffer, etc.) | SynqPost |
|---|---|---|
| Monthly cost | $29–$499/mo | $0 (bring your own VPS + API key) |
| Post limits | 1,250–5,000 credits | Unlimited |
| Self-hostable | ✗ | ✓ |
| Open source | ✗ | ✓ |
| Brand voice | Generic prompts | Deep product context |
| Your data | Their servers | Your server |

---

## Features

- **AI content generation** — Claude writes platform-native posts tuned to your brand voice, product, and niche. Twitter threads, LinkedIn essays, Instagram captions, Facebook posts — each formatted correctly for the platform.
- **Full autopilot scheduler** — Cron jobs generate and publish daily. Sunday batch mode fills your entire next week automatically.
- **4-platform publishing** — Native API integrations with Twitter v2, LinkedIn UGC Posts, and Meta Graph API (Facebook + Instagram). No middleware.
- **Content queue with dashboard** — Weekly calendar view, approve/edit/delete drafts, generate on-demand, analytics overview.
- **REST API** — Every feature accessible via HTTP. Integrate with your existing tooling, n8n, or Make.com.
- **SQLite queue** — Lightweight, zero-config persistence. `draft → scheduled → posted` state machine.
- **Docker-first** — One command to deploy. Runs on any $5/mo VPS.

---

## Quick Start

### Prerequisites

- Node.js 20+ or Docker
- [Anthropic API key](https://console.anthropic.com) (required — powers AI generation)
- Platform API keys for whichever platforms you want to post to (optional — add one at a time)

### Option A — Docker (recommended)

```bash
git clone https://github.com/synqworks/synqpost.git
cd synqpost

cp .env.example .env
# Fill in your API keys — at minimum, set ANTHROPIC_API_KEY

docker compose up -d
```

That's it. The API runs on `http://localhost:3001` and the scheduler starts automatically.

### Option B — Node.js

```bash
git clone https://github.com/synqworks/synqpost.git
cd synqpost
npm install

cp .env.example .env
# Fill in your API keys

npm start
```

### Verify it's running

```bash
curl http://localhost:3001/health
# {"status":"ok","uptime":12.4,"time":"2026-08-03T14:00:00.000Z"}
```

---

## Configuration

All configuration lives in `.env`. Copy `.env.example` to get started:

```bash
cp .env.example .env
```

### Required

```env
ANTHROPIC_API_KEY=sk-ant-...        # Powers all AI content generation
```

### Platform credentials (add whichever platforms you want)

```env
# Twitter / X — developer.twitter.com
TWITTER_API_KEY=
TWITTER_API_SECRET=
TWITTER_ACCESS_TOKEN=
TWITTER_ACCESS_SECRET=

# LinkedIn — linkedin.com/developers/apps
LINKEDIN_ACCESS_TOKEN=              # OAuth 2.0 token with w_member_social scope
LINKEDIN_PERSON_URN=                # urn:li:person:XXXXXXXX

# Facebook + Instagram — developers.facebook.com
META_ACCESS_TOKEN=                  # Page access token
FACEBOOK_PAGE_ID=
INSTAGRAM_ACCOUNT_ID=
INSTAGRAM_DEFAULT_IMAGE_URL=        # Required — Instagram needs an image for feed posts
```

### Scheduler behavior

```env
AUTO_APPROVE=false       # true = skip draft review, publish automatically
POSTS_PER_DAY=2          # Posts generated per day
TZ=America/New_York      # Scheduler timezone
```

### Brand voice

```env
BRAND_NAME=YourBrand
PRODUCT_NAME=YourProduct
BRAND_VOICE=Direct, founder-authentic, slightly technical. Building in public.
```

---

## How the autopilot works

```
Sunday 10 PM    → Generates 7-day content batch, saves as drafts
Daily 7 AM      → Generates Twitter + LinkedIn posts for 9 AM slot
Daily 10 AM     → Generates Instagram + Facebook posts for 12 PM slot
Every 5 min     → Checks queue for due posts, publishes them
```

With `AUTO_APPROVE=false` (default), posts land in the queue as drafts. Review and approve via the dashboard or API before they go out.

With `AUTO_APPROVE=true`, everything publishes automatically with no intervention.

---

## API Reference

The REST API runs on port `3001` (configurable via `PORT`).

### Posts

```
GET    /api/posts                   List all posts (?status=draft|scheduled|posted)
POST   /api/posts                   Add a post manually
PUT    /api/posts/:id/approve       Approve a draft → scheduled
POST   /api/posts/approve-all       Approve all drafts
POST   /api/posts/:id/publish       Publish immediately (bypasses scheduler)
DELETE /api/posts/:id               Remove a post
```

### Generate

```
POST   /api/generate                Generate a post (preview only, not saved)
POST   /api/generate/save           Generate + save to queue
POST   /api/generate/week           Generate + save full 7-day batch
```

### System

```
GET    /api/stats                   Post counts by status
GET    /api/logs                    Recent activity log (last 100 events)
GET    /health                      Health check
```

### Example — generate and queue a post

```bash
curl -X POST http://localhost:3001/api/generate/save \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "twitter",
    "niche": "tech",
    "tone": "founder-authentic",
    "scheduledFor": "2026-08-04T09:00:00",
    "autoApprove": true
  }'
```

### Example — generate a 7-day batch

```bash
curl -X POST http://localhost:3001/api/generate/week \
  -H "Content-Type: application/json" \
  -d '{
    "platforms": ["twitter", "linkedin", "instagram", "facebook"],
    "niche": "mix",
    "tone": "founder-authentic",
    "postsPerDay": 2,
    "autoApprove": false
  }'
```

---

## Project structure

```
synqpost/
├── src/
│   ├── index.js                    Entry point (API + scheduler)
│   ├── db.js                       SQLite queue (posts + run log)
│   ├── api/
│   │   └── server.js               Express REST API
│   ├── generators/
│   │   └── contentGenerator.js     Claude-powered content engine
│   ├── publishers/
│   │   ├── index.js                Publisher router
│   │   ├── twitter.js              Twitter v2 API
│   │   ├── linkedin.js             LinkedIn UGC Posts API
│   │   └── meta.js                 Meta Graph API (Facebook + Instagram)
│   └── scheduler/
│       └── cron.js                 Autopilot cron jobs
├── data/                           SQLite DB (auto-created)
├── .env.example                    Environment variable template
├── docker-compose.yml
└── Dockerfile
```

---

## Getting platform API credentials

### Twitter / X
1. Go to [developer.twitter.com](https://developer.twitter.com/en/portal/dashboard)
2. Create a project and app
3. Set app permissions to **Read + Write**
4. Generate Access Token & Secret under "Keys and Tokens"
5. Copy all four values to `.env`

> ⚠️ Free tier = 500 tweets/month. At 2 posts/day, you'll need the Basic tier ($100/mo) for sustained use.

### LinkedIn
1. Create an app at [linkedin.com/developers/apps](https://www.linkedin.com/developers/apps)
2. Request the `w_member_social` permission
3. Complete OAuth 2.0 flow to get an access token
4. Find your Person URN: `GET https://api.linkedin.com/v2/me` → copy the `id` field, format as `urn:li:person:{id}`

> ⚠️ LinkedIn access tokens expire every 60 days. Set a calendar reminder to refresh.

### Facebook + Instagram
1. Create an app at [developers.facebook.com](https://developers.facebook.com/apps)
2. Add the **Facebook Login** and **Instagram Graph API** products
3. Get a Page Access Token with `pages_manage_posts` permission via Graph API Explorer
4. Find your Facebook Page ID: Page → About → Page ID
5. Find your Instagram Business Account ID in Meta Business Suite → Settings

> ℹ️ Instagram feed posts require an image URL. Set `INSTAGRAM_DEFAULT_IMAGE_URL` to a publicly accessible branded graphic (1080×1080px recommended).

---

## Deploying to a VPS

SynqPost runs comfortably on a $5–6/mo VPS (Hetzner CAX11, DigitalOcean Droplet, etc.).

```bash
# On your VPS
git clone https://github.com/synqworks/synqpost.git /opt/synqpost
cd /opt/synqpost
cp .env.example .env
nano .env   # fill in your keys

docker compose up -d

# Check it's running
docker compose logs -f
curl http://localhost:3001/health
```

To expose the API over HTTPS with a domain, add a reverse proxy block to your nginx config:

```nginx
location /synqpost/ {
    proxy_pass http://localhost:3001/;
    proxy_set_header Host $host;
}
```

---

## Roadmap

- [x] AI content generation (Claude)
- [x] Twitter/X, LinkedIn, Facebook, Instagram publishers
- [x] Cron-based autopilot scheduler
- [x] SQLite queue with draft/scheduled/posted states
- [x] REST API
- [x] Web dashboard
- [ ] Content repurposing — YouTube video → posts
- [ ] Content repurposing — blog post / URL → posts
- [ ] Image generation for Instagram
- [ ] Multi-brand support
- [ ] Cloud hosted tier
- [ ] Webhook support

Vote on features or suggest new ones by [opening an issue](https://github.com/synqworks/synqpost/issues).

---

## Contributing

PRs welcome. SynqPost is intentionally simple — please keep it that way.

```bash
git clone https://github.com/synqworks/synqpost.git
cd synqpost
npm install
cp .env.example .env   # add your Anthropic key at minimum
npm run dev            # hot reload via --watch
```

For new platform publishers, follow the pattern in `src/publishers/twitter.js` — export `postTo{Platform}(content)` and register it in `src/publishers/index.js`.

---

## Built by

[SynqWorks](https://synqworks.com) — indie dev building in public.

Also check out [StatusWatch](https://statuswatch.dev) — uptime monitoring for small SaaS teams.

---

## License

MIT — use it, fork it, sell it, build on it.

---

*If SynqPost saves you money on social media tools, consider [starring the repo](https://github.com/synqworks/synqpost) — it's the indie dev equivalent of a tip jar.*
