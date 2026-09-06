import { getSetting, setSetting } from "../kernel/db";
import { readCapped, trunc } from "../kernel/util";

export const MAX_LOG_SOURCES = 10;
export const MAX_LOG_BODY = 8 * 1024;
const HOT_MS = 24 * 60 * 60 * 1000;
const PRUNE_EVERY_MS = 60 * 60 * 1000;
const PRUNE_BATCH = 500;

export type LogSource = {
  id: string;
  name: string;
  token: string;
  enabled: number;
  created_at: number;
};

export type LogEvent = {
  key: string;
  ts: number;
  level: string | null;
  message: string;
  data: unknown;
};

export async function listLogSources(db: D1Database): Promise<LogSource[]> {
  const { results } = await db
    .prepare("SELECT * FROM log_sources ORDER BY created_at ASC")
    .all<LogSource>();
  return results ?? [];
}

export async function getLogSource(db: D1Database, id: string): Promise<LogSource | null> {
  return (await db.prepare("SELECT * FROM log_sources WHERE id = ?").bind(id).first<LogSource>()) ?? null;
}

type EventInput = { ts: number; level: string | null; message: string; data: unknown };

function insertStmt(env: Env, sourceId: string, event: EventInput): D1PreparedStatement {
  const data = event.data === undefined || event.data === null ? null : JSON.stringify(event.data);
  return env.DB.prepare(
    `INSERT INTO log_events (source_id, ts, level, message, data, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?2)
     ON CONFLICT (source_id, ts, message) DO NOTHING`,
  ).bind(sourceId, event.ts, event.level, trunc(event.message, 400), data);
}

export async function ingest(
  env: Env,
  token: string,
  request: Request,
): Promise<{ ok: true; ts: number } | { ok: false; status: number; error: string }> {
  const source = await env.DB.prepare(
    "SELECT * FROM log_sources WHERE token = ? AND enabled = 1",
  )
    .bind(token)
    .first<LogSource>();
  if (!source) return { ok: false, status: 404, error: "unknown token" };

  const len = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(len) && len > MAX_LOG_BODY) {
    return { ok: false, status: 413, error: `body > ${MAX_LOG_BODY} bytes` };
  }
  if (!request.body) return { ok: false, status: 400, error: "empty body" };
  const raw = await readCapped(request.body, MAX_LOG_BODY + 1);
  if (raw.length > MAX_LOG_BODY) {
    return { ok: false, status: 413, error: `body > ${MAX_LOG_BODY} bytes` };
  }
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, status: 400, error: "empty body" };

  const now = Date.now();
  const parsed = parsePayload(trimmed);
  await insertStmt(env, source.id, { ts: now, ...parsed }).run();
  return { ok: true, ts: now };
}

/** Store events for a source; returns how many new rows landed (idempotent re-syncs write 0). */
export async function putLogEvents(env: Env, sourceId: string, events: EventInput[]): Promise<number> {
  if (!events.length) return 0;
  const results = await env.DB.batch(events.map((e) => insertStmt(env, sourceId, e)));
  return results.reduce((n, r) => n + (r.meta?.changes ?? 0), 0);
}

export type EventRow = LogEvent & { id: number; source_id: string };

/** One indexed query for the explorer: source/level/search filters, newest first. */
export async function queryEvents(
  env: Env,
  opts: {
    sourceId?: string | null;
    level?: string | null;
    q?: string | null;
    limit: number;
    /** Sources whose GET/POST access lines are hidden (quiet CF mappings). */
    quietSources?: string[];
  },
): Promise<EventRow[]> {
  const where: string[] = [];
  const binds: (string | number)[] = [];
  if (opts.sourceId) {
    where.push("source_id = ?");
    binds.push(opts.sourceId);
  }
  if (opts.level) {
    where.push("IFNULL(LOWER(level), 'log') = ?");
    binds.push(opts.level);
  }
  if (opts.q) {
    const needle = opts.q.toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`);
    where.push("LOWER(message) LIKE ? ESCAPE '\\'");
    binds.push(`%${needle}%`);
  }
  if (opts.quietSources?.length) {
    const placeholders = opts.quietSources.map(() => "?").join(",");
    // CF sync writes "[service] GET …"; direct ingests may log bare "GET …".
    const verbs = ["GET", "POST", "PUT", "PATCH", "DELETE"]
      .flatMap((v) => [`message LIKE '[%] ${v} %'`, `message LIKE '${v} %'`])
      .join(" OR ");
    // Cron heartbeat noise: bare or "[service] "-prefixed.
    const heartbeat = `LOWER(message) IN ('tick', '* * * * *')
       OR message LIKE '[%] tick'
       OR message LIKE '[%] * * * * *'`;
    where.push(`NOT (source_id IN (${placeholders}) AND ((${verbs}) OR ${heartbeat}))`);
    binds.push(...opts.quietSources);
  }
  binds.push(Math.min(1000, Math.max(1, opts.limit)));
  const sql = `SELECT id, source_id, ts, level, message, data FROM log_events${
    where.length ? ` WHERE ${where.join(" AND ")}` : ""
  } ORDER BY ts DESC LIMIT ?`;
  const { results } = await env.DB.prepare(sql)
    .bind(...binds)
    .all<{ id: number; source_id: string; ts: number; level: string | null; message: string; data: string | null }>();
  return (results ?? []).map((r) => ({
    key: `${r.source_id}:${r.id}`,
    id: r.id,
    source_id: r.source_id,
    ts: r.ts,
    level: r.level,
    message: r.message,
    data: parseData(r.data),
  }));
}

export async function deleteSourceLogs(env: Env, sourceId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM log_events WHERE source_id = ?").bind(sourceId).run();
  await deleteLegacyR2Logs(env, sourceId);
}

export async function maybePruneLogs(env: Env, now: number): Promise<void> {
  const last = Number((await getSetting(env.DB, "last_log_prune_at")) ?? 0);
  if (now - last < PRUNE_EVERY_MS) return;
  const cutoff = now - HOT_MS;
  await env.DB
    .prepare("DELETE FROM log_events WHERE id IN (SELECT id FROM log_events WHERE ts < ? LIMIT ?)")
    .bind(cutoff, PRUNE_BATCH)
    .run();
  await deleteLegacyR2Logs(env, null, cutoff);
  await setSetting(env.DB, "last_log_prune_at", String(now));
}

/** Pre-D1 events lived as R2 objects under logs/… — prune the leftovers away. */
async function deleteLegacyR2Logs(env: Env, sourceId: string | null, cutoff?: number): Promise<void> {
  if (!env.BUCKET) return;
  const prefix = sourceId ? `logs/${sourceId}/` : "logs/";
  let cursor: string | undefined;
  let n = 0;
  do {
    const page = await env.BUCKET.list({ prefix, cursor, limit: 100 });
    let keys = page.objects.map((o) => o.key);
    if (cutoff !== undefined) {
      keys = keys.filter((k, i) => (tsFromKey(k) ?? page.objects[i].uploaded.getTime()) < cutoff);
    }
    if (keys.length) await env.BUCKET.delete(keys);
    n += keys.length;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && n < PRUNE_BATCH);
}

function parseData(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function parsePayload(raw: string): { level: string | null; message: string; data: unknown } {
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const rec = v as Record<string, unknown>;
      const level = typeof rec.level === "string" ? trunc(rec.level, 16) : null;
      const message = pickMessage(rec) || trunc(JSON.stringify(v), 200);
      return { level, message, data: v };
    }
    return { level: null, message: trunc(String(v), 200), data: v };
  } catch {
    return { level: null, message: trunc(raw, 200), data: raw };
  }
}

function pickMessage(rec: Record<string, unknown>): string | null {
  for (const k of ["message", "msg", "error", "text"]) {
    const v = rec[k];
    if (typeof v === "string" && v.trim()) return trunc(v.trim(), 200);
  }
  return null;
}

const INV_EPOCH = 1_000_000_000_000_000;

function tsFromKey(key: string): number | null {
  const m = key.match(/\/(\d{16})-[0-9a-f]+\.json$/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return INV_EPOCH - n;
}
