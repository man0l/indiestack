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
    d1: { monitors, jobs, log_sources, settings, checks },
    r2: { rollups, log_events },
  };
}

export function backupFilename(now = Date.now()): string {
  return `indiestack-${ymd(now)}.json`;
}

async function all<T = Record<string, unknown>>(db: D1Database, sql: string): Promise<T[]> {
  const { results } = await db.prepare(sql).all<T>();
  return results ?? [];
}
