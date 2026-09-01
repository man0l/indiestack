import { getSetting, setSetting } from "../kernel/db";
import { readCapped, trunc } from "../kernel/util";

export const MAX_LOG_SOURCES = 10;
export const MAX_LOG_BODY = 8 * 1024;
const TAIL = 50;
const HOT_MS = 24 * 60 * 60 * 1000;
const PRUNE_EVERY_MS = 60 * 60 * 1000;
const PRUNE_BATCH = 100;
const INV_EPOCH = 1_000_000_000_000_000;

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
  const event: LogEvent = {
    key: eventKey(source.id, now),
    ts: now,
    level: parsed.level,
    message: parsed.message,
    data: parsed.data,
  };
  await env.BUCKET.put(event.key, JSON.stringify(event), {
    httpMetadata: { contentType: "application/json" },
    customMetadata: {
      ts: String(now),
      level: event.level ?? "",
      message: event.message.slice(0, 180),
    },
  });
  return { ok: true, ts: now };
}

export async function listEvents(env: Env, sourceId: string, limit = TAIL): Promise<LogEvent[]> {
  const listed = await env.BUCKET.list({
    prefix: `logs/${sourceId}/`,
    limit,
    include: ["customMetadata"],
  });
  const out: LogEvent[] = [];
  for (const obj of listed.objects) {
    const meta = obj.customMetadata ?? {};
    const ts = Number(meta.ts) || tsFromKey(obj.key) || obj.uploaded.getTime();
    out.push({
      key: obj.key,
      ts,
      level: meta.level ? meta.level : null,
      message: meta.message || "(event)",
      data: null,
    });
  }
  return out;
}

export async function deleteSourceLogs(env: Env, sourceId: string): Promise<void> {
  let cursor: string | undefined;
  let n = 0;
  do {
    const page = await env.BUCKET.list({ prefix: `logs/${sourceId}/`, cursor, limit: 100 });
    const keys = page.objects.map((o) => o.key);
    if (keys.length) await env.BUCKET.delete(keys);
    n += keys.length;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && n < 500);
}

export async function maybePruneLogs(env: Env, now: number): Promise<void> {
  const last = Number((await getSetting(env.DB, "last_log_prune_at")) ?? 0);
  if (now - last < PRUNE_EVERY_MS) return;
  const cutoff = now - HOT_MS;
  let cursor: string | undefined;
  let deleted = 0;
  do {
    const page = await env.BUCKET.list({ prefix: "logs/", cursor, limit: 100 });
    const stale = page.objects
      .filter((o) => {
        const ts = tsFromKey(o.key) ?? o.uploaded.getTime();
        return ts < cutoff;
      })
      .map((o) => o.key);
    if (stale.length) await env.BUCKET.delete(stale);
    deleted += stale.length;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && deleted < PRUNE_BATCH);
  await setSetting(env.DB, "last_log_prune_at", String(now));
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

function eventKey(sourceId: string, ts: number): string {
  const inv = String(INV_EPOCH - ts).padStart(16, "0");
  const id = crypto.randomUUID().replaceAll("-", "");
  return `logs/${sourceId}/${inv}-${id}.json`;
}

function tsFromKey(key: string): number | null {
  const m = key.match(/\/(\d{16})-[0-9a-f]+\.json$/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return INV_EPOCH - n;
}
