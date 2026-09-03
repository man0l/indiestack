import { getSetting, setSetting } from "./db";
import { ymd } from "./util";

const HOT_MS = 24 * 60 * 60 * 1000;
const PRUNE_EVERY_MS = 60 * 60 * 1000;

export async function maybeRollup(env: Env, now: number): Promise<void> {
  const today = ymd(now);
  const last = await getSetting(env.DB, "last_rollup");
  if (!last) {
    await setSetting(env.DB, "last_rollup", today);
    return;
  }
  if (last === today) return;

  const yesterday = ymd(now - 86400000);
  const start = Date.parse(`${yesterday}T00:00:00.000Z`);
  const end = start + 86400000;

  const stats = await env.DB.prepare(
    `SELECT m.id, m.name, m.url,
            COUNT(c.id) AS n,
            SUM(c.ok) AS ok_n,
            AVG(c.latency_ms) AS avg_latency_ms
     FROM monitors m
     LEFT JOIN checks c ON c.monitor_id = m.id AND c.ts >= ? AND c.ts < ?
     GROUP BY m.id`,
  )
    .bind(start, end)
    .all<{
      id: string;
      name: string;
      url: string;
      n: number;
      ok_n: number | null;
      avg_latency_ms: number | null;
    }>();

  const jobs = await env.DB.prepare(
    "SELECT id, name, status, last_beat_at, interval_min FROM jobs",
  ).all<{
    id: string;
    name: string;
    status: string;
    last_beat_at: number | null;
    interval_min: number;
  }>();

  const deploys = await env.DB.prepare(
    "SELECT name, provider, repo, project, status, last_detail, last_error FROM deploy_targets",
  ).all();

  const analytics = await env.DB.prepare(
    `SELECT s.name AS site, h.path, COUNT(*) AS views
     FROM hits h JOIN analytics_sites s ON s.id = h.site_id
     WHERE h.day = ?
     GROUP BY s.id, h.path ORDER BY views DESC`,
  )
    .bind(yesterday)
    .all<{ site: string; path: string; views: number }>();

  const body = JSON.stringify({
    date: yesterday,
    monitors: (stats.results ?? []).map((row) => {
      const n = Number(row.n) || 0;
      const ok_n = Number(row.ok_n) || 0;
      return {
        id: row.id,
        name: row.name,
        url: row.url,
        checks: n,
        up: ok_n,
        down: Math.max(0, n - ok_n),
        avg_latency_ms: row.avg_latency_ms == null ? null : Math.round(row.avg_latency_ms),
        uptime_pct: n === 0 ? null : Math.round((ok_n / n) * 1000) / 10,
      };
    }),
    jobs: jobs.results ?? [],
    deploys: deploys.results ?? [],
    analytics: analytics.results ?? [],
  });

  await env.BUCKET.put(`rollups/${yesterday}.json`, body, {
    httpMetadata: { contentType: "application/json" },
  });
  await setSetting(env.DB, "last_rollup", today);
}

export async function maybePrune(env: Env, now: number): Promise<void> {
  const last = Number((await getSetting(env.DB, "last_prune_at")) ?? 0);
  if (now - last < PRUNE_EVERY_MS) return;
  await env.DB.prepare("DELETE FROM checks WHERE ts < ?")
    .bind(now - HOT_MS)
    .run();
  await setSetting(env.DB, "last_prune_at", String(now));
}
