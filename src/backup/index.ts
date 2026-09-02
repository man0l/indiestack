import { ymd } from "../kernel/util";

export type Backup = {
  v: 1;
  exported_at: number;
  app: string;
  d1: {
    monitors: unknown[];
    jobs: unknown[];
    log_sources: unknown[];
    settings: Record<string, string>;
    checks: unknown[];
    deploy_targets: unknown[];
    agent_tokens: unknown[];
    analytics_sites: unknown[];
  };
  r2: {
    rollups: Record<string, unknown>;
    log_events: Record<string, Array<{ ts: number; level: string | null; message: string }>>;
  };
};

export async function buildBackup(env: Env): Promise<Backup> {
  const monitors = await all(env.DB, "SELECT * FROM monitors ORDER BY created_at ASC");
  const jobs = await all(env.DB, "SELECT * FROM jobs ORDER BY created_at ASC");
  const log_sources = await all<{ id: string }>(
    env.DB,
    "SELECT * FROM log_sources ORDER BY created_at ASC",
  );
  const deploy_targets = await all(env.DB, "SELECT * FROM deploy_targets ORDER BY created_at ASC");
  const agent_tokens = await all(env.DB, "SELECT * FROM agent_tokens ORDER BY created_at ASC");
  const analytics_sites = await all(
    env.DB,
    "SELECT * FROM analytics_sites ORDER BY created_at ASC",
  );
  const settingRows = await all<{ key: string; value: string }>(env.DB, "SELECT key, value FROM settings");
  const settings: Record<string, string> = {};
  for (const row of settingRows) settings[row.key] = row.value;
  const checks = await all(env.DB, "SELECT * FROM checks ORDER BY ts ASC");

  const rollups: Record<string, unknown> = {};
  const listed = await env.BUCKET.list({ prefix: "rollups/" });
  for (const obj of listed.objects) {
    const got = await env.BUCKET.get(obj.key);
    if (!got) continue;
    const date = obj.key.replace(/^rollups\//, "").replace(/\.json$/, "");
    try {
      rollups[date] = await got.json();
    } catch {
      rollups[date] = await got.text();
    }
  }

  const log_events: Backup["r2"]["log_events"] = {};
  for (const source of log_sources) {
    const page = await env.BUCKET.list({
      prefix: `logs/${source.id}/`,
      limit: 50,
      include: ["customMetadata"],
    });
    log_events[source.id] = page.objects.map((o) => {
      const meta = o.customMetadata ?? {};
      return {
        ts: Number(meta.ts) || o.uploaded.getTime(),
        level: meta.level ? meta.level : null,
        message: meta.message || "(event)",
      };
    });
  }

  return {
    v: 1,
    exported_at: Date.now(),
    app: env.APP_NAME,
    d1: { monitors, jobs, log_sources, settings, checks, deploy_targets, agent_tokens, analytics_sites },
    r2: { rollups, log_events },
  };
}

export function backupFilename(now = Date.now()): string {
  return `indiestack-${ymd(now)}.json`;
}

export const MAX_BACKUP_BYTES = 2 * 1024 * 1024;
const BATCH = 40;
const INV_EPOCH = 1_000_000_000_000_000;

export type RestoreStats = {
  monitors: number;
  jobs: number;
  log_sources: number;
  settings: number;
  checks: number;
  deploy_targets: number;
  agent_tokens: number;
  analytics_sites: number;
  rollups: number;
  log_events: number;
};

export function parseBackup(raw: string): Backup {
  let data: unknown;
  try {
    data = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("not JSON");
  }
  if (!data || typeof data !== "object") throw new Error("bad backup");
  const o = data as Record<string, unknown>;
  if (o.v !== 1) throw new Error("unsupported backup version");
  const d1 = (o.d1 ?? {}) as Record<string, unknown>;
  const r2 = (o.r2 ?? {}) as Record<string, unknown>;
  const settingsRaw = d1.settings;
  const settings: Record<string, string> = {};
  if (settingsRaw && typeof settingsRaw === "object" && !Array.isArray(settingsRaw)) {
    for (const [k, v] of Object.entries(settingsRaw as Record<string, unknown>)) {
      if (typeof v === "string") settings[k] = v;
    }
  }
  return {
    v: 1,
    exported_at: Number(o.exported_at) || Date.now(),
    app: typeof o.app === "string" ? o.app : "indiestack",
    d1: {
      monitors: Array.isArray(d1.monitors) ? d1.monitors : [],
      jobs: Array.isArray(d1.jobs) ? d1.jobs : [],
      log_sources: Array.isArray(d1.log_sources) ? d1.log_sources : [],
      settings,
      checks: Array.isArray(d1.checks) ? d1.checks : [],
      deploy_targets: Array.isArray(d1.deploy_targets) ? d1.deploy_targets : [],
      agent_tokens: Array.isArray(d1.agent_tokens) ? d1.agent_tokens : [],
      analytics_sites: Array.isArray(d1.analytics_sites) ? d1.analytics_sites : [],
    },
    r2: {
      rollups:
        r2.rollups && typeof r2.rollups === "object" && !Array.isArray(r2.rollups)
          ? (r2.rollups as Record<string, unknown>)
          : {},
      log_events:
        r2.log_events && typeof r2.log_events === "object" && !Array.isArray(r2.log_events)
          ? (r2.log_events as Backup["r2"]["log_events"])
          : {},
    },
  };
}

export async function restoreBackup(env: Env, backup: Backup): Promise<RestoreStats> {
  const stmts: D1PreparedStatement[] = [];

  for (const raw of backup.d1.monitors) {
    const m = asRec(raw);
    const id = str(m.id);
    if (!id) continue;
    stmts.push(
      env.DB.prepare(
        `INSERT OR REPLACE INTO monitors (
           id, name, url, interval_min, expect_status, timeout_ms,
           keyword, keyword_mode, max_latency_ms, enabled, status,
           last_check_at, last_status_code, last_latency_ms, last_error,
           consecutive, created_at, mute_until, headers, nag_min, last_nag_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        str(m.name, id).slice(0, 40),
        str(m.url),
        int(m.interval_min, 5),
        int(m.expect_status, 0),
        int(m.timeout_ms, 8000),
        nulstr(m.keyword),
        nulstr(m.keyword_mode),
        nulint(m.max_latency_ms),
        int(m.enabled, 1),
        str(m.status, "unknown"),
        nulint(m.last_check_at),
        nulint(m.last_status_code),
        nulint(m.last_latency_ms),
        nulstr(m.last_error),
        int(m.consecutive, 0),
        int(m.created_at, Date.now()),
        nulint(m.mute_until),
        nulstr(m.headers),
        int(m.nag_min, 0),
        nulint(m.last_nag_at),
      ),
    );
  }

  for (const raw of backup.d1.jobs) {
    const j = asRec(raw);
    const id = str(j.id);
    const token = str(j.token);
    if (!id || !token) continue;
    stmts.push(
      env.DB.prepare(
        `INSERT OR REPLACE INTO jobs (
           id, name, token, interval_min, grace_min, enabled, status,
           last_beat_at, last_error, consecutive, created_at, mute_until, nag_min, last_nag_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        str(j.name, id).slice(0, 40),
        token,
        int(j.interval_min, 60),
        int(j.grace_min, 2),
        int(j.enabled, 1),
        str(j.status, "unknown"),
        nulint(j.last_beat_at),
        nulstr(j.last_error),
        int(j.consecutive, 0),
        int(j.created_at, Date.now()),
        nulint(j.mute_until),
        int(j.nag_min, 0),
        nulint(j.last_nag_at),
      ),
    );
  }

  for (const raw of backup.d1.log_sources) {
    const s = asRec(raw);
    const id = str(s.id);
    const token = str(s.token);
    if (!id || !token) continue;
    stmts.push(
      env.DB.prepare(
        `INSERT OR REPLACE INTO log_sources (id, name, token, enabled, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(id, str(s.name, id).slice(0, 40), token, int(s.enabled, 1), int(s.created_at, Date.now())),
    );
  }

  for (const raw of backup.d1.deploy_targets) {
    const t = asRec(raw);
    const id = str(t.id);
    if (!id) continue;
    stmts.push(
      env.DB.prepare(
        `INSERT OR REPLACE INTO deploy_targets (
           id, provider, name, repo, project, team, interval_min, enabled, status,
           last_check_at, last_detail, last_error, consecutive, mute_until, nag_min,
           last_nag_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        str(t.provider, "github") === "vercel" ? "vercel" : "github",
        str(t.name, id).slice(0, 40),
        nulstr(t.repo),
        nulstr(t.project),
        nulstr(t.team),
        int(t.interval_min, 5),
        int(t.enabled, 1),
        str(t.status, "unknown"),
        nulint(t.last_check_at),
        nulstr(t.last_detail),
        nulstr(t.last_error),
        int(t.consecutive, 0),
        nulint(t.mute_until),
        int(t.nag_min, 0),
        nulint(t.last_nag_at),
        int(t.created_at, Date.now()),
      ),
    );
  }

  for (const raw of backup.d1.agent_tokens) {
    const a = asRec(raw);
    const id = str(a.id);
    const token = str(a.token);
    if (!id || !token) continue;
    stmts.push(
      env.DB.prepare(
        `INSERT OR REPLACE INTO agent_tokens (id, name, token, enabled, last_used_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        str(a.name, id).slice(0, 40),
        token,
        int(a.enabled, 1),
        nulint(a.last_used_at),
        int(a.created_at, Date.now()),
      ),
    );
  }

  for (const raw of backup.d1.analytics_sites) {
    const s = asRec(raw);
    const id = str(s.id);
    const token = str(s.token);
    if (!id || !token) continue;
    stmts.push(
      env.DB.prepare(
        `INSERT OR REPLACE INTO analytics_sites (id, name, token, enabled, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(id, str(s.name, id).slice(0, 40), token, int(s.enabled, 1), int(s.created_at, Date.now())),
    );
  }

  for (const [key, value] of Object.entries(backup.d1.settings)) {
    stmts.push(
      env.DB.prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).bind(key, value),
    );
  }

  for (const raw of backup.d1.checks) {
    const c = asRec(raw);
    const monitorId = str(c.monitor_id);
    if (!monitorId) continue;
    if (c.id != null && Number.isFinite(Number(c.id))) {
      stmts.push(
        env.DB.prepare(
          `INSERT OR REPLACE INTO checks (id, monitor_id, ts, ok, status_code, latency_ms, error)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          Number(c.id),
          monitorId,
          int(c.ts, Date.now()),
          int(c.ok, 0),
          nulint(c.status_code),
          nulint(c.latency_ms),
          nulstr(c.error),
        ),
      );
    } else {
      stmts.push(
        env.DB.prepare(
          `INSERT INTO checks (monitor_id, ts, ok, status_code, latency_ms, error)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(
          monitorId,
          int(c.ts, Date.now()),
          int(c.ok, 0),
          nulint(c.status_code),
          nulint(c.latency_ms),
          nulstr(c.error),
        ),
      );
    }
  }

  await runBatches(env.DB, stmts);

  let rollups = 0;
  for (const [date, payload] of Object.entries(backup.r2.rollups)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const body = typeof payload === "string" ? payload : JSON.stringify(payload);
    await env.BUCKET.put(`rollups/${date}.json`, body, {
      httpMetadata: { contentType: "application/json" },
    });
    rollups++;
  }

  let log_events = 0;
  for (const [sourceId, events] of Object.entries(backup.r2.log_events)) {
    if (!sourceId || !Array.isArray(events)) continue;
    for (const ev of events) {
      const ts = int(ev.ts, Date.now());
      const level = ev.level ? String(ev.level).slice(0, 16) : null;
      const message = str(ev.message, "(event)").slice(0, 200);
      const key = logKey(sourceId, ts);
      const event = { key, ts, level, message, data: { message } };
      await env.BUCKET.put(key, JSON.stringify(event), {
        httpMetadata: { contentType: "application/json" },
        customMetadata: {
          ts: String(ts),
          level: level ?? "",
          message: message.slice(0, 180),
        },
      });
      log_events++;
    }
  }

  return {
    monitors: backup.d1.monitors.length,
    jobs: backup.d1.jobs.length,
    log_sources: backup.d1.log_sources.length,
    settings: Object.keys(backup.d1.settings).length,
    checks: backup.d1.checks.length,
    deploy_targets: backup.d1.deploy_targets.length,
    agent_tokens: backup.d1.agent_tokens.length,
    analytics_sites: backup.d1.analytics_sites.length,
    rollups,
    log_events,
  };
}

async function runBatches(db: D1Database, stmts: D1PreparedStatement[]): Promise<void> {
  for (let i = 0; i < stmts.length; i += BATCH) {
    await db.batch(stmts.slice(i, i + BATCH));
  }
}

function logKey(sourceId: string, ts: number): string {
  const inv = String(INV_EPOCH - ts).padStart(16, "0");
  return `logs/${sourceId}/${inv}-${crypto.randomUUID().replaceAll("-", "")}.json`;
}

function asRec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown, fallback = ""): string {
  if (v == null) return fallback;
  return String(v);
}

function nulstr(v: unknown): string | null {
  if (v == null || v === "") return null;
  return String(v);
}

function int(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function nulint(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function all<T = Record<string, unknown>>(db: D1Database, sql: string): Promise<T[]> {
  const { results } = await db.prepare(sql).all<T>();
  return results ?? [];
}
