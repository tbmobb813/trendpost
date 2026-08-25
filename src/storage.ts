import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import * as path from 'path';
import * as fs from 'fs';

export type PostStatus = 'draft' | 'scheduled' | 'published' | 'failed';
export type Platform = 'twitter' | 'linkedin' | 'instagram' | 'threads' | 'facebook';

export interface ScheduledPost {
  id: string;
  content: string;
  platform: Platform;
  scheduledAt: Date;
  status: PostStatus;
  createdAt: Date;
  publishedAt?: Date;
  errorMessage?: string;
  tags: string[];
  campaignId?: string;
  platformPostId?: string;
}

export interface ContentIdea {
  id: string;
  topic: string;
  angle: string;
  platform: Platform;
  status: 'idea' | 'approved' | 'written' | 'scheduled';
  createdAt: Date;
  scheduledFor?: Date;
  campaignId?: string;
}

export type CampaignSource = 'manual' | 'gtm' | 'repurpose';

export interface Campaign {
  id: string;
  name: string;
  source: CampaignSource;
  createdAt: Date;
}

export class TrendPostStorage {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath ?? process.env.DATABASE_PATH ?? path.join('data', 'trendpost.db');
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    this.db = new Database(resolvedPath, { timeout: 5000 });
    this.init();
    this.db.pragma('journal_mode = WAL');
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scheduled_posts (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        platform TEXT NOT NULL,
        scheduled_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TEXT NOT NULL,
        published_at TEXT,
        error_message TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        campaign_id TEXT,
        platform_post_id TEXT
      );

      CREATE TABLE IF NOT EXISTS content_ideas (
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        angle TEXT NOT NULL,
        platform TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'idea',
        created_at TEXT NOT NULL,
        scheduled_for TEXT,
        campaign_id TEXT
      );

      CREATE TABLE IF NOT EXISTS campaigns (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_posts_status ON scheduled_posts(status);
      CREATE INDEX IF NOT EXISTS idx_posts_scheduled ON scheduled_posts(scheduled_at);
      CREATE INDEX IF NOT EXISTS idx_posts_platform ON scheduled_posts(platform);

      CREATE TABLE IF NOT EXISTS run_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event TEXT NOT NULL,
        platform TEXT,
        post_id TEXT,
        detail TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_log_created ON run_log(created_at);
    `);
  }

  // ─── POSTS ────────────────────────────────────────────────────

  createPost(params: {
    content: string;
    platform: Platform;
    scheduledAt: Date;
    tags?: string[];
    campaignId?: string;
    status?: PostStatus;
  }): ScheduledPost {
    const id = randomUUID();
    const now = new Date();

    this.db
      .prepare(
        `
      INSERT INTO scheduled_posts (id, content, platform, scheduled_at, status, created_at, tags, campaign_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        id,
        params.content,
        params.platform,
        params.scheduledAt.toISOString(),
        params.status ?? 'scheduled',
        now.toISOString(),
        JSON.stringify(params.tags ?? []),
        params.campaignId ?? null
      );

    return this.getPost(id)!;
  }

  getPost(id: string): ScheduledPost | null {
    const row = this.db.prepare('SELECT * FROM scheduled_posts WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapPost(row) : null;
  }

  listPosts(filters?: {
    status?: PostStatus;
    platform?: Platform;
    from?: Date;
    to?: Date;
  }): ScheduledPost[] {
    let sql = 'SELECT * FROM scheduled_posts WHERE 1=1';
    const params: unknown[] = [];

    if (filters?.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }
    if (filters?.platform) {
      sql += ' AND platform = ?';
      params.push(filters.platform);
    }
    if (filters?.from) {
      sql += ' AND scheduled_at >= ?';
      params.push(filters.from.toISOString());
    }
    if (filters?.to) {
      sql += ' AND scheduled_at <= ?';
      params.push(filters.to.toISOString());
    }

    sql += ' ORDER BY scheduled_at ASC';
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.mapPost(r));
  }

  updatePostStatus(
    id: string,
    status: PostStatus,
    errorMessage?: string,
    platformPostId?: string
  ): void {
    // platform_post_id uses COALESCE so a plain status-only call (e.g. the
    // self-report path used by markPublished, which never passes this arg)
    // never clobbers an ID recorded by an earlier call.
    this.db
      .prepare(
        `
      UPDATE scheduled_posts
      SET status = ?, published_at = ?, error_message = ?, platform_post_id = COALESCE(?, platform_post_id)
      WHERE id = ?
    `
      )
      .run(
        status,
        status === 'published' ? new Date().toISOString() : null,
        errorMessage ?? null,
        platformPostId ?? null,
        id
      );
  }

  deletePost(id: string): void {
    this.db.prepare('DELETE FROM scheduled_posts WHERE id = ?').run(id);
  }

  // ─── IDEAS ────────────────────────────────────────────────────

  createIdea(params: {
    topic: string;
    angle: string;
    platform: Platform;
    scheduledFor?: Date;
    campaignId?: string;
  }): ContentIdea {
    const id = randomUUID();
    this.db
      .prepare(
        `
      INSERT INTO content_ideas (id, topic, angle, platform, status, created_at, scheduled_for, campaign_id)
      VALUES (?, ?, ?, ?, 'idea', ?, ?, ?)
    `
      )
      .run(
        id,
        params.topic,
        params.angle,
        params.platform,
        new Date().toISOString(),
        params.scheduledFor?.toISOString() ?? null,
        params.campaignId ?? null
      );

    const row = this.db.prepare('SELECT * FROM content_ideas WHERE id = ?').get(id) as Record<
      string,
      unknown
    >;
    return this.mapIdea(row);
  }

  listIdeas(status?: string): ContentIdea[] {
    const sql = status
      ? 'SELECT * FROM content_ideas WHERE status = ? ORDER BY created_at DESC, rowid DESC'
      : 'SELECT * FROM content_ideas ORDER BY created_at DESC, rowid DESC';
    const rows = this.db.prepare(sql).all(...(status ? [status] : [])) as Record<string, unknown>[];
    return rows.map((r) => this.mapIdea(r));
  }

  // ─── CAMPAIGNS ────────────────────────────────────────────────

  createCampaign(params: { name: string; source: CampaignSource }): Campaign {
    const id = randomUUID();
    const now = new Date();
    this.db
      .prepare(
        `
      INSERT INTO campaigns (id, name, source, created_at)
      VALUES (?, ?, ?, ?)
    `
      )
      .run(id, params.name, params.source, now.toISOString());

    return { id, name: params.name, source: params.source, createdAt: now };
  }

  listCampaigns(): Campaign[] {
    const rows = this.db
      .prepare('SELECT * FROM campaigns ORDER BY created_at DESC, rowid DESC')
      .all() as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      source: r.source as CampaignSource,
      createdAt: new Date(r.created_at as string),
    }));
  }

  // ─── AUDIT LOG ──────────────────────────────────────────────────

  log(event: string, platform?: string, postId?: string, detail?: string): void {
    this.db
      .prepare(`INSERT INTO run_log (event, platform, post_id, detail, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(event, platform ?? null, postId ?? null, detail ?? null, new Date().toISOString());
  }

  recentLogs(limit = 100): {
    id: number;
    event: string;
    platform: string | null;
    postId: string | null;
    detail: string | null;
    createdAt: Date;
  }[] {
    const rows = this.db
      .prepare('SELECT * FROM run_log ORDER BY id DESC LIMIT ?')
      .all(limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as number,
      event: r.event as string,
      platform: (r.platform as string | null) ?? null,
      postId: (r.post_id as string | null) ?? null,
      detail: (r.detail as string | null) ?? null,
      createdAt: new Date(r.created_at as string),
    }));
  }

  // ─── STATS ────────────────────────────────────────────────────

  getStats(): { total: number; draft: number; scheduled: number; published: number; failed: number } {
    const rows = this.db
      .prepare('SELECT status, COUNT(*) as c FROM scheduled_posts GROUP BY status')
      .all() as { status: PostStatus; c: number }[];
    const byStatus: Record<PostStatus, number> = { draft: 0, scheduled: 0, published: 0, failed: 0 };
    let total = 0;
    for (const row of rows) {
      byStatus[row.status] = row.c;
      total += row.c;
    }
    return { total, ...byStatus };
  }

  private mapPost(r: Record<string, unknown>): ScheduledPost {
    return {
      id: r.id as string,
      content: r.content as string,
      platform: r.platform as Platform,
      scheduledAt: new Date(r.scheduled_at as string),
      status: r.status as PostStatus,
      createdAt: new Date(r.created_at as string),
      publishedAt: r.published_at ? new Date(r.published_at as string) : undefined,
      errorMessage: (r.error_message as string | null) ?? undefined,
      tags: JSON.parse(r.tags as string),
      campaignId: (r.campaign_id as string | null) ?? undefined,
      platformPostId: (r.platform_post_id as string | null) ?? undefined,
    };
  }

  private mapIdea(r: Record<string, unknown>): ContentIdea {
    return {
      id: r.id as string,
      topic: r.topic as string,
      angle: r.angle as string,
      platform: r.platform as Platform,
      status: r.status as ContentIdea['status'],
      createdAt: new Date(r.created_at as string),
      scheduledFor: r.scheduled_for ? new Date(r.scheduled_for as string) : undefined,
      campaignId: (r.campaign_id as string | null) ?? undefined,
    };
  }
}
