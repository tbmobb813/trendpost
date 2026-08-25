# TrendPost

> AI content generation & scheduling — an MCP server built for WireAssist.

TrendPost is the module that powers WireAssist's Content agent: it generates
platform-native social posts, queues and schedules them, publishes them via
official APIs, and reports outcomes back to WireAssist's Kanban/Objectives
board.

## Where the code lives

**This repo is a name/history pointer only — it does not contain the active
source.** Development happens in the WireAssist monorepo:

- Repo: [`tbmobb813/WireAssist`](https://github.com/tbmobb813/WireAssist)
- Package: `packages/trendpost-mcp/` (published internally as `@wireassist/trendpost-mcp`)

If you're looking to run, build, or contribute to TrendPost, clone
`WireAssist`, not this repo.

## What it is

`@wireassist/trendpost-mcp` is an MCP server: SQLite-backed storage for
campaigns, content ideas, and scheduled/published posts, plus the MCP tool
handlers (`registerTrendPostTools`) that WireAssist's Content agent
(`@wireassist/agent-content`) calls to generate and manage content. It isn't
a standalone service you deploy on its own — it's consumed by the Content
agent and operated through WireAssist's Command Center dashboard.

## Capabilities

- **Multi-platform publishing** — native integrations for Twitter/X,
  LinkedIn, and Meta (Facebook + Instagram):
  `packages/trendpost-mcp/src/publishers/{twitter,linkedin,meta}.ts`
- **Content & schedule storage** — campaigns, content ideas, and scheduled
  posts in SQLite: `packages/trendpost-mcp/src/storage.ts`
- **MCP tools for the Content agent** — content generation, scheduling, and
  management tools registered via `registerTrendPostTools`
- **Auto-publish cron** — `dev/auto-publish.sh` in WireAssist drives
  unattended publishing on a schedule
- **Outcome attribution** — publish results get attributed back to the
  originating Objective's Kanban board
- **Content performance retros** — built-in reporting on how published
  content performed

## Setup

Full setup lives in the WireAssist repo, not here, so these instructions
don't drift out of sync again:

- [`WireAssist/README.md`](https://github.com/tbmobb813/WireAssist#readme) — Quick start
- [`WireAssist/docs/SETUP.md`](https://github.com/tbmobb813/WireAssist/blob/main/docs/SETUP.md) — full setup guide
- [`WireAssist/docs/ARCHITECTURE.md`](https://github.com/tbmobb813/WireAssist/blob/main/docs/ARCHITECTURE.md) — how `trendpost-mcp` fits into the rest of the system

## Status

This repo predates TrendPost's move into the WireAssist monorepo (it was
originally scaffolded as a standalone project called SynqPost). It's kept
around for history and the name; it is not maintained independently.
