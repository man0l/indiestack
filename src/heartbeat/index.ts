import { flushAlerts, sendAlert } from "../kernel/alert";
import { getSetting } from "../kernel/db";
import { isMuted, type Job } from "../kernel/types";
import { agoMs } from "../kernel/util";

export async function recordBeat(env: Env, token: string): Promise<Job | null> {
  const job = await env.DB.prepare("SELECT * FROM jobs WHERE token = ?")
    .bind(token)
    .first<Job>();
  if (!job) return null;
  const now = Date.now();
  const prev = job.status;
  await env.DB.prepare(
    `UPDATE jobs SET status = 'up', last_beat_at = ?, last_error = NULL, consecutive = 0, last_nag_at = NULL
     WHERE id = ?`,
  )
    .bind(now, job.id)
    .run();
  if (prev === "down" && job.enabled && !isMuted(job.enabled, job.mute_until, now)) {
    const webhook = await getSetting(env.DB, "webhook_url");
    if (webhook) {
      await sendAlert(webhook, `UP · ${job.name} · beat received`).catch((err) =>
        console.error("alert failed", String(err)),
      );
    }
  }
  return { ...job, status: "up", last_beat_at: now, last_error: null, consecutive: 0 };
}

export async function scanHeartbeats(
  env: Env,
  now: number,
  webhook: string | null,
): Promise<{ scanned: number; alerts: number }> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM jobs WHERE enabled = 1 AND (mute_until IS NULL OR mute_until <= ?)",
  )
    .bind(now)
    .all<Job>();
  const jobs = results ?? [];
  const stmts: D1PreparedStatement[] = [];
  const pendingAlerts: string[] = [];

  for (const j of jobs) {
    const anchor = j.last_beat_at ?? j.created_at;
    const deadline = anchor + (j.interval_min + j.grace_min) * 60000;
    if (now < deadline) continue;
    const nagMin = j.nag_min ?? 0;
    const lastNag = j.last_nag_at ?? null;
    if (j.status === "down") {
      if (nagMin > 0 && (lastNag == null || now - lastNag >= nagMin * 60000)) {
        pendingAlerts.push(`STILL DOWN · ${j.name} · missed beat`);
        stmts.push(env.DB.prepare(`UPDATE jobs SET last_nag_at = ? WHERE id = ?`).bind(now, j.id));
      }
      continue;
    }
    stmts.push(
      env.DB.prepare(
        `UPDATE jobs SET status = 'down', last_error = ?, consecutive = 1, last_nag_at = ? WHERE id = ?`,
      ).bind("missed beat", now, j.id),
    );
    pendingAlerts.push(
      `DOWN · ${j.name} · missed beat (every ${j.interval_min}m, last ${agoMs(anchor, now)})`,
    );
  }

  if (stmts.length) await env.DB.batch(stmts);
  const alerts = await flushAlerts(webhook, pendingAlerts);
  return { scanned: jobs.length, alerts };
}
