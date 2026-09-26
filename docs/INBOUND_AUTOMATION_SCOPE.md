# Inbound automation: comment-to-DM + email capture

Scope for extending TrendPost with the inbound half of the funnel pattern
Blotato already sells as a hosted product: someone comments a keyword on a
published post, TrendPost DMs them automatically, optionally gates the DM
behind an email reply, and logs the result as a lead.

**Why build instead of use Blotato:** Blotato does this well at $29-97/mo,
forever, per account. TrendPost already owns ~80% of the required plumbing
(Meta Graph API credentials and helper, an interval-loop scheduler, a
SQLite storage class, a Hono route-registration pattern) on infrastructure
already paid for. The marginal cost of extending it is a one-time build
plus the Meta App Review submission — not a recurring bill. Matches the
"own it once instead of renting monthly" principle already applied to the
resume-tools product line.

**Platform order:** Instagram + Facebook first (the `META_ACCESS_TOKEN` /
`FACEBOOK_PAGE_ID` / `INSTAGRAM_ACCOUNT_ID` credentials already exist in
`.env.example` and are already used by `src/publishers/meta.ts`). Twitter
and LinkedIn are explicitly out of scope for now — Twitter's DM/mentions
endpoints are gated behind paid API tiers, LinkedIn has no third-party
inbound DM API at all.

---

## 1. Storage — `src/storage.ts`

Two new tables, additive only, following the existing
`CREATE TABLE IF NOT EXISTS` convention:

```sql
CREATE TABLE IF NOT EXISTS keyword_triggers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,          -- 'facebook' | 'instagram'
  post_id TEXT,                    -- platform_post_id to scope to, or NULL for "any post"
  keyword TEXT NOT NULL,           -- matched whole-word, case-insensitive
  dm_message TEXT NOT NULL,        -- up to platform's char limit
  require_email BOOLEAN NOT NULL DEFAULT 0,
  lead_magnet_url TEXT,
  active BOOLEAN NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  external_user_id TEXT NOT NULL,  -- platform's commenter/sender id
  email TEXT,                      -- NULL until email-gate resolves
  matched_keyword TEXT NOT NULL,
  trigger_id INTEGER NOT NULL REFERENCES keyword_triggers(id),
  source_comment_id TEXT,
  status TEXT NOT NULL,            -- 'dm_sent' | 'awaiting_email' | 'captured' | 'expired'
  captured_at TEXT,
  created_at TEXT NOT NULL
);
```

New `TrendPostStorage` methods, mirroring the existing `createPost`/
`listPosts`/`updatePostStatus` shape: `createTrigger`, `listTriggers`,
`createLead`, `updateLeadStatus`, `listLeads(filters)`.

`leads.trigger_id` and `keyword_triggers.post_id` piggyback on the
`platform_post_id` field `scheduled_posts` already stores — no new
cross-referencing mechanism needed.

## 2. Comment/DM helpers — `src/publishers/meta.ts`

Extend the existing file rather than adding a new one, since it already
holds `GRAPH_API_BASE`, `requireEnv()`, and `graphPost()`. Add:

- `graphGet(path, params)` — the read-side twin of `graphPost()`, same
  `fetch()` + `URLSearchParams` shape.
- `listComments(postId)` — `GET /{post-id}/comments`.
- `sendDirectMessage(recipientId, message, linkButtons?)` — `POST` to the
  Send API (`/{page-id}/messages`), same auth pattern as
  `postToFacebook`/`postToInstagram`.

## 3. Inbound sweep loop — `src/inbox-sweep.ts` (new file)

Direct sibling of `src/scheduler.ts`, same shape:

- `runInboxSweep(storage)`: for each active trigger, list comments on its
  scoped post (or all recent posts if `post_id` is NULL), match against
  the keyword, skip any `external_user_id` that already has a lead for
  that trigger (idempotency), send the DM via `sendDirectMessage`, create
  a `leads` row, catch per-comment failures without aborting the sweep —
  identical error-isolation behavior to `runPublishSweep`.
- `startInboxSweep(storage)`: reads a new `INBOX_CHECK_INTERVAL_MS` env var
  (default 300000ms, matching `PUBLISH_CHECK_INTERVAL_MS`'s default),
  `tick()` immediately then `setInterval`, logs via `storage.log('INBOX_SWEEP', ...)`,
  returns `{stop}`.
- Email-gate expiry: on each sweep, also flip any `awaiting_email` lead
  older than 1 hour to `expired` (matches Blotato's documented window —
  no reason to diverge without a stated reason).

## 4. Routes — `src/routes/inbox.ts` (new file) + `src/server.ts`

New file following the existing `registerXRoutes(app, storage)` convention
used by every other route module:

- `POST /api/triggers` — create a keyword trigger
- `GET /api/triggers` — list triggers
- `PATCH /api/triggers/:id` — activate/deactivate
- `GET /api/leads` — list captured leads, filterable by platform/status

In `server.ts`, add `registerInboxRoutes(app, storage)` alongside the
existing `register*Routes` calls, and add `/api/triggers`, `/api/leads` to
the same rate-limiter scope as the other write-heavy routes if warranted
(likely not — this is polling-driven, not per-request LLM spend, unlike
`/api/content/*`).

Call `startInboxSweep(storage)` next to the existing `startScheduler(storage)`
call after `serve()`.

## 5. MCP exposure — `@wireassist/trendpost-mcp`

Once the routes exist, add matching tools (`create_keyword_trigger`,
`list_leads`) to the MCP server the same way existing TrendPost
capabilities are already exposed there — out of scope for this doc's
file-level detail since that's a separate package, but the route shapes
above are designed to map 1:1 onto tool definitions.

## 6. Meta App Review

The one real one-time cost, not a code cost. Needs, before this works on
the actual production Instagram/Facebook accounts (not just developer
test users):

- `pages_messaging` (already likely covered if posting is live)
- `instagram_manage_comments`
- `instagram_manage_messages`

Submission requires a screen-recorded walkthrough of the actual use case
(comment → DM → email capture) — plan for this to be built and working
against test users *before* starting the review submission, since the
recording has to show the real flow. Lead time is Meta's, not ours;
historically days to a couple weeks, not instant.

## Explicitly out of scope for this pass

- Twitter/X inbound (cost decision, not a build decision — flag separately
  if you want to revisit)
- LinkedIn inbound (not viable regardless of effort)
- Webhooks (Meta supports real-time comment webhooks; this scope uses
  polling to match the codebase's existing convention and ship faster —
  revisit only if 5-minute latency proves too slow in practice)
- Any UI in `command-center` for managing triggers — API-only for this pass
