import { notifyAll } from "../kernel/alert";
import { getSetting } from "../kernel/db";
import { trunc } from "../kernel/util";

export const MAX_DEPLOY_TARGETS = 10;
const BATCH = 5;

export type DeployTarget = {
  id: string;
  provider: "github" | "vercel";
  name: string;
  repo: string | null;
  project: string | null;
  team: string | null;
  interval_min: number;
  enabled: number;
  status: "up" | "down" | "unknown";
  last_check_at: number | null;
  last_detail: string | null;
  last_error: string | null;
  consecutive: number;
  mute_until: number | null;
  nag_min: number;
  last_nag_at: number | null;
  created_at: number;
};

export type DeployResult = {
  /** true/false = deploy state · null = probe/infra error, keep previous status */
  ok: boolean | null;
  detail: string | null;
  error: string | null;
};

const UA = "indiestack-deploys/0.1";

function jsonHeaders(token: string | null): HeadersInit {
  const h: Record<string, string> = { accept: "application/json", "user-agent": UA };
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  let msg = "";
  try {
    msg = (JSON.parse(text) as { message?: string }).message ?? "";
  } catch {
    msg = text;
  }
  return trunc(msg || `http ${res.status}`, 160);
}

/** Validate a GitHub PAT and return the login it belongs to. Throws on rejection. */
export async function connectGithub(token: string): Promise<string> {
  const res = await fetch("https://api.github.com/user", { headers: jsonHeaders(token) });
  if (!res.ok) throw new Error(await readError(res));
  const json = (await res.json()) as { login?: string };
  if (!json.login) throw new Error("no login in response");
  return json.login;
}

/** Validate a Vercel token and return the account name it belongs to. Throws on rejection. */
export async function connectVercel(token: string): Promise<string> {
  const res = await fetch("https://api.vercel.com/v2/user", { headers: jsonHeaders(token) });
  if (!res.ok) throw new Error(await readError(res));
  const json = (await res.json()) as { user?: { username?: string; email?: string } };
  const who = json.user?.username || json.user?.email;
  if (!who) throw new Error("no user in response");
  return who;
}

/** Resolve a Vercel project id or slug to its canonical id. Returns null if unknown. */
export async function resolveVercelProject(
  token: string,
  team: string | null,
  idOrName: string,
): Promise<{ id: string; name: string } | null> {
  const qs = team ? `?teamId=${encodeURIComponent(team)}` : "";
  const res = await fetch(
    `https://api.vercel.com/v9/projects/${encodeURIComponent(idOrName)}${qs}`,
    { headers: jsonHeaders(token) },
  );
  if (!res.ok) return null;
  const json = (await res.json()) as { id?: string; name?: string };
  if (!json.id) return null;
  return { id: json.id, name: json.name ?? idOrName };
}

async function githubProbe(t: DeployTarget, token: string | null): Promise<DeployResult> {
  if (!t.repo || !t.repo.includes("/")) {
    return { ok: null, detail: null, error: "bad repo (owner/repo)" };
  }
  const base = `https://api.github.com/repos/${t.repo}`;
  const depRes = await fetch(`${base}/deployments?per_page=1`, {
    headers: jsonHeaders(token),
  });
  if (depRes.status === 404) {
    return { ok: false, detail: null, error: "repo not found (check repo or token scope)" };
  }
  if (depRes.status === 403) {
    return { ok: null, detail: null, error: await readError(depRes) };
  }
  if (!depRes.ok) {
    return { ok: null, detail: null, error: `github ${depRes.status}` };
  }
  const deployments = (await depRes.json()) as Array<{
    id: number;
    sha: string | null;
    environment?: string;
  }>;
  const latest = deployments[0];
  if (!latest) {
    return { ok: true, detail: "no deployments yet", error: null };
  }
  const stRes = await fetch(`${base}/deployments/${latest.id}/statuses?per_page=1`, {
    headers: jsonHeaders(token),
  });
  if (!stRes.ok) {
    return { ok: null, detail: null, error: `github ${stRes.status}` };
  }
  const statuses = (await stRes.json()) as Array<{ state?: string }>;
  const state = statuses[0]?.state ?? "pending";
  const env = latest.environment ?? "production";
  const sha = (latest.sha ?? "").slice(0, 7);
  const detail = `${env}${sha ? ` · ${sha}` : ""} · ${state}`;
  if (state === "success" || state === "active") {
    return { ok: true, detail, error: null };
  }
  if (state === "pending" || state === "in_progress" || state === "queued") {
    return { ok: true, detail: `${detail} (running)`, error: null };
  }
  return { ok: false, detail, error: `deploy ${state}` };
}

async function vercelProbe(t: DeployTarget, token: string | null): Promise<DeployResult> {
  if (!token) return { ok: null, detail: null, error: "vercel not connected" };
  if (!t.project) return { ok: null, detail: null, error: "project required" };
  const qs = new URLSearchParams({ limit: "1", target: "production", projectId: t.project });
  if (t.team) qs.set("teamId", t.team);
  const res = await fetch(`https://api.vercel.com/v6/deployments?${qs.toString()}`, {
    headers: jsonHeaders(token),
  });
  if (res.status === 401 || res.status === 403) {
    return { ok: false, detail: null, error: await readError(res) };
  }
  if (res.status === 404) {
    return { ok: false, detail: null, error: "project not found (check id or team)" };
  }
  if (!res.ok) {
    return { ok: null, detail: null, error: `vercel ${res.status}` };
  }
  const json = (await res.json()) as {
    deployments?: Array<{ readyState?: string; url?: string; uid?: string }>;
  };
  const dep = json.deployments?.[0];
  if (!dep) return { ok: true, detail: "no deployments yet", error: null };
  const state = dep.readyState ?? "UNKNOWN";
  const label = dep.url || dep.uid || t.project;
  if (state === "READY") return { ok: true, detail: `${label} · ready`, error: null };
  if (state === "ERROR") return { ok: false, detail: label, error: "deploy error" };
  if (state === "CANCELED") return { ok: false, detail: label, error: "deploy canceled" };
  return { ok: true, detail: `${label} · ${state.toLowerCase()}`, error: null };
}

export async function probeTarget(t: DeployTarget, env: Env): Promise<DeployResult> {
  const token =
    t.provider === "github"
      ? await getSetting(env.DB, "github_token")
      : await getSetting(env.DB, "vercel_token");
  try {
    return t.provider === "github" ? await githubProbe(t, token) : await vercelProbe(t, token);
  } catch (err) {
    return { ok: null, detail: null, error: trunc(String(err), 160) };
  }
}

export type DeployStats = { scanned: number; alerts: number };

export async function scanDeploys(env: Env, now: number): Promise<DeployStats> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM deploy_targets
     WHERE enabled = 1 AND (mute_until IS NULL OR mute_until <= ?)
       AND (last_check_at IS NULL OR last_check_at + interval_min * 60000 <= ?)
     ORDER BY last_check_at ASC`,
  )
    .bind(now, now)
    .all<DeployTarget>();
  const targets = results ?? [];
  let alerts = 0;

  for (let i = 0; i < targets.length; i += BATCH) {
    const slice = targets.slice(i, i + BATCH);
    const results = await Promise.all(slice.map((t) => probeTarget(t, env)));

    const stmts: D1PreparedStatement[] = [];
    const pending: string[] = [];

    for (let j = 0; j < slice.length; j++) {
      const t = slice[j];
      const r = results[j];
      // Infra error: record it, keep the previous status, no alert.
      if (r.ok === null) {
        stmts.push(
          env.DB.prepare(
            `UPDATE deploy_targets SET last_check_at = ?, last_error = ? WHERE id = ?`,
          ).bind(now, r.error, t.id),
        );
        continue;
      }
      const next: "up" | "down" = r.ok ? "up" : "down";
      const prev = t.status;
      const consecutive = next === prev ? t.consecutive + 1 : 1;
      let lastNag = t.last_nag_at ?? null;
      if (!r.ok && prev !== "down") {
        pending.push(`DOWN · ${t.name} · ${t.provider} deploy failed · ${r.error ?? "fail"}`);
        lastNag = now;
      } else if (!r.ok && (t.nag_min ?? 0) > 0 && (lastNag == null || now - lastNag >= t.nag_min * 60000)) {
        pending.push(`STILL DOWN · ${t.name} · ${t.provider} · ${r.error ?? "fail"}`);
        lastNag = now;
      } else if (r.ok && prev === "down") {
        pending.push(`UP · ${t.name} · ${t.provider} · ${r.detail ?? "deploy ok"}`);
        lastNag = null;
      }
      stmts.push(
        env.DB.prepare(
          `UPDATE deploy_targets SET
             status = ?, last_check_at = ?, last_detail = ?, last_error = ?,
             consecutive = ?, last_nag_at = ?
           WHERE id = ?`,
        ).bind(next, now, r.detail, r.error, consecutive, lastNag, t.id),
      );
    }

    if (stmts.length) await env.DB.batch(stmts);
    alerts += await notifyAll(env, pending);
  }

  return { scanned: targets.length, alerts };
}

/** Insert a target with its first real check result so the status page is truthful immediately. */
export async function insertDeployTarget(env: Env, t: DeployTarget): Promise<void> {
  const first = await probeTarget(t, env);
  const status: "up" | "down" | "unknown" =
    first.ok == null ? "unknown" : first.ok ? "up" : "down";
  await env.DB.prepare(
    `INSERT INTO deploy_targets (
       id, provider, name, repo, project, team, interval_min, enabled, status,
       last_check_at, last_detail, last_error, consecutive, mute_until, nag_min,
       last_nag_at, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL, ?)`,
  )
    .bind(
      t.id,
      t.provider,
      t.name,
      t.repo,
      t.project,
      t.team,
      t.interval_min,
      t.enabled,
      status,
      Date.now(),
      first.detail,
      first.error,
      t.mute_until,
      t.nag_min,
      t.created_at,
    )
    .run();
}

export async function listDeployTargets(env: Env): Promise<DeployTarget[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM deploy_targets ORDER BY created_at ASC",
  ).all<DeployTarget>();
  return results ?? [];
}

export async function deployOverview(env: Env): Promise<{
  targets: DeployTarget[];
  github: { connected: boolean; who: string | null };
  vercel: { connected: boolean; who: string | null };
}> {
  const [targets, githubUser, vercelUser] = await Promise.all([
    listDeployTargets(env),
    getSetting(env.DB, "github_user"),
    getSetting(env.DB, "vercel_user"),
  ]);
  return {
    targets,
    github: { connected: githubUser != null, who: githubUser },
    vercel: { connected: vercelUser != null, who: vercelUser },
  };
}

/** Manual "check now": probe one target immediately and persist the result. */
export async function checkTargetNow(env: Env, id: string): Promise<DeployTarget | null> {
  const t = await env.DB.prepare("SELECT * FROM deploy_targets WHERE id = ?")
    .bind(id)
    .first<DeployTarget>();
  if (!t) return null;
  const r = await probeTarget(t, env);
  const next: "up" | "down" | "unknown" =
    r.ok == null ? t.status : r.ok ? "up" : "down";
  const consecutive = r.ok == null ? t.consecutive : next === t.status ? t.consecutive + 1 : 1;
  await env.DB.prepare(
    `UPDATE deploy_targets SET
       status = ?, last_check_at = ?, last_detail = ?, last_error = ?, consecutive = ?
     WHERE id = ?`,
  )
    .bind(next, Date.now(), r.detail, r.error, consecutive, t.id)
    .run();
  return { ...t, status: next, last_check_at: Date.now(), last_detail: r.detail, last_error: r.error, consecutive };
}

/** Repos the connected GitHub token can see, most recently pushed first. */
export async function listUserRepos(
  token: string,
): Promise<Array<{ full_name: string; private: boolean; pushed_at: string }>> {
  const out: Array<{ full_name: string; private: boolean; pushed_at: string }> = [];
  for (const page of [1, 2]) {
    const res = await fetch(
      `https://api.github.com/user/repos?per_page=100&sort=pushed&page=${page}&affiliation=owner,collaborator,organization_member`,
      { headers: jsonHeaders(token) },
    );
    if (!res.ok) throw new Error(await readError(res));
    const rows = (await res.json()) as Array<{
      full_name: string;
      private: boolean;
      pushed_at: string;
    }>;
    out.push(
      ...rows.map((r) => ({
        full_name: r.full_name,
        private: !!r.private,
        pushed_at: r.pushed_at ?? "",
      })),
    );
    if (rows.length < 100) break;
  }
  return out;
}

/** Probe + insert several targets in parallel. Returns how many were added. */
export async function insertDeployTargetsBulk(env: Env, targets: DeployTarget[]): Promise<number> {
  if (!targets.length) return 0;
  const probed = await Promise.all(targets.map((t) => probeTarget(t, env)));
  const stmts = targets.map((t, i) => {
    const first = probed[i];
    const status: "up" | "down" | "unknown" =
      first.ok == null ? "unknown" : first.ok ? "up" : "down";
    return env.DB.prepare(
      `INSERT INTO deploy_targets (
         id, provider, name, repo, project, team, interval_min, enabled, status,
         last_check_at, last_detail, last_error, consecutive, mute_until, nag_min,
         last_nag_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL, ?)`,
    ).bind(
      t.id,
      t.provider,
      t.name,
      t.repo,
      t.project,
      t.team,
      t.interval_min,
      t.enabled,
      status,
      Date.now(),
      first.detail,
      first.error,
      t.mute_until,
      t.nag_min,
      t.created_at,
    );
  });
  await env.DB.batch(stmts);
  return targets.length;
}
