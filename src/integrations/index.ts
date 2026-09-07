import { notifyAll } from "../kernel/alert";
import { getSetting, setSetting } from "../kernel/db";
import { trunc } from "../kernel/util";
import { putLogEvents } from "../logs/index";

export const MAX_DEPLOY_TARGETS = 10;
const BATCH = 5;

export type DeployTarget = {
  id: string;
  provider: "github" | "vercel" | "cloudflare";
  name: string;
  repo: string | null;
  project: string | null;
  team: string | null;
  account: string | null;
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
  site_id: string | null;
  last_commits: string | null;
};

export type CommitInfo = {
  sha: string;
  msg: string;
  ts: number;
  url: string | null;
  merge: boolean;
};

export function parseCommits(raw: string | null): CommitInfo[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === "object")
      .slice(0, 3)
      .map((c) => ({
        sha: String(c.sha ?? "").slice(0, 7),
        msg: String(c.msg ?? "").slice(0, 120),
        ts: Number(c.ts) || 0,
        url: typeof c.url === "string" ? c.url : null,
        merge: c.merge === true,
      }))
      .filter((c) => c.sha);
  } catch {
    return [];
  }
}

export type DeployResult = {
  /** true/false = deploy state · null = probe/infra error, keep previous status */
  ok: boolean | null;
  detail: string | null;
  error: string | null;
  /** recent commits (github) — empty for vercel / failures */
  commits?: CommitInfo[];
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

/** Vercel projects visible to the token (for the picker). */
export async function listVercelProjects(
  token: string,
  team: string | null,
): Promise<Array<{ id: string; name: string }>> {
  const qs = new URLSearchParams({ limit: "100" });
  if (team) qs.set("teamId", team);
  const res = await fetch(`https://api.vercel.com/v9/projects?${qs}`, { headers: jsonHeaders(token) });
  if (!res.ok) throw new Error(await readError(res));
  const json = (await res.json()) as { projects?: Array<{ id?: string; name?: string }> };
  return (json.projects ?? [])
    .filter((p) => p.id && p.name)
    .map((p) => ({ id: p.id as string, name: p.name as string }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Vercel teams visible to the token (for scoping project queries). */
export async function listVercelTeams(token: string): Promise<Array<{ id: string; slug: string }>> {
  const res = await fetch("https://api.vercel.com/v2/teams", { headers: jsonHeaders(token) });
  if (!res.ok) throw new Error(await readError(res));
  const json = (await res.json()) as { teams?: Array<{ id?: string; slug?: string; name?: string }> };
  return (json.teams ?? [])
    .filter((t) => t.id)
    .map((t) => ({ id: t.id as string, slug: t.slug ?? t.name ?? (t.id as string) }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Vercel project id -> log source id. `quiet` keeps only warn+error (drops info chatter). */
export type VercelLogMap = Record<string, { source: string; team: string | null; quiet: boolean }>;

export async function getVercelMapping(env: Env): Promise<VercelLogMap> {
  const raw = await getSetting(env.DB, "vercel_log_sources");
  if (!raw) return {};
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object" || Array.isArray(o)) return {};
    const out: VercelLogMap = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (typeof k !== "string" || !k) continue;
      if (typeof v === "string" && v) out[k.slice(0, 80)] = { source: v, team: null, quiet: false };
      else if (v && typeof v === "object" && typeof (v as { source?: unknown }).source === "string") {
        const vv = v as { source: string; team?: unknown; quiet?: unknown };
        if (vv.source) {
          out[k.slice(0, 80)] = {
            source: vv.source,
            team: typeof vv.team === "string" ? vv.team : null,
            quiet: vv.quiet === true,
          };
        }
      }
    }
    return out;
  } catch {
    return {};
  }
}

export async function setVercelMapping(env: Env, mapping: Record<string, unknown>): Promise<VercelLogMap> {
  const valid = await env.DB.prepare("SELECT id FROM log_sources").all<{ id: string }>();
  const ids = new Set((valid.results ?? []).map((r) => r.id));
  const clean: VercelLogMap = {};
  for (const [k, v] of Object.entries(mapping).slice(0, 20)) {
    if (typeof k !== "string" || !k) continue;
    const source = typeof v === "string" ? v : (v as { source?: unknown })?.source;
    const team = typeof v === "object" && v !== null ? (v as { team?: unknown }).team : null;
    const quiet = typeof v === "object" && v !== null && (v as { quiet?: unknown }).quiet === true;
    if (typeof source === "string" && ids.has(source)) {
      clean[k.slice(0, 80)] = { source, team: typeof team === "string" && team ? team : null, quiet };
    }
  }
  await setSetting(env.DB, "vercel_log_sources", JSON.stringify(clean));
  return clean;
}
export type VercelLogEvent = { ts: number; level: string; message: string; project: string };

/**
 * Vercel events carry no explicit level — build lines arrive as typed streams
 * (stdout/stderr/command/…). npm prints warnings on stderr and build chatter
 * mentions "fail", so warn patterns win first and bare stderr stays neutral.
 */
function classifyVercelLevel(kind: string, text: string): string {
  const k = kind.toLowerCase();
  if (/warn/i.test(k) || /warn/i.test(text) || text.includes("⚠")) return "warn";
  if (k && k !== "stderr" && /err|fail|fatal/i.test(k)) return "error";
  if (/err(or)?|fail(ed|ure)?|fatal|exception|unhandled/i.test(text)) return "error";
  return "info";
}

/** Runtime log events of a Vercel project's latest production deployment. */
export async function queryVercelLogs(
  env: Env,
  projectId: string,
  team: string | null,
  limit = 50,
): Promise<{ events: VercelLogEvent[]; error: string | null }> {
  const token = await getSetting(env.DB, "vercel_token");
  if (!token) return { events: [], error: "vercel not connected" };
  const q = new URLSearchParams({ limit: "1", target: "production", projectId });
  if (team) q.set("teamId", team);
  let uid: string;
  try {
    const res = await fetch(`https://api.vercel.com/v6/deployments?${q}`, { headers: jsonHeaders(token) });
    if (res.status === 401 || res.status === 403) return { events: [], error: "token rejected" };
    if (!res.ok) return { events: [], error: `vercel ${res.status}` };
    const json = (await res.json()) as { deployments?: Array<{ uid?: string }> };
    const first = json.deployments?.[0]?.uid;
    if (!first) return { events: [], error: null };
    uid = first;
  } catch (err) {
    return { events: [], error: trunc(String(err), 160) };
  }
  try {
    const eq = new URLSearchParams({ limit: String(Math.min(100, Math.max(1, limit))) });
    if (team) eq.set("teamId", team);
    const res = await fetch(`https://api.vercel.com/v2/deployments/${uid}/events?${eq}`, {
      headers: jsonHeaders(token),
    });
    if (!res.ok) return { events: [], error: `vercel ${res.status}` };
    const json = (await res.json()) as unknown;
    const arr = Array.isArray(json) ? json : [];
    const events: VercelLogEvent[] = [];
    for (const item of arr.slice(0, 100)) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const payload = (o.payload ?? {}) as Record<string, unknown>;
      const text = String(payload.text ?? payload.message ?? o.message ?? "").slice(0, 300);
      if (!text) continue;
      const tsRaw = o.date ?? o.created ?? o.timestamp ?? Date.now();
      const kind = String(o.type ?? "");
      events.push({
        ts: typeof tsRaw === "number" ? tsRaw : Date.parse(String(tsRaw)) || Date.now(),
        level: classifyVercelLevel(kind, text),
        message: text,
        project: projectId,
      });
    }
    return { events, error: null };
  } catch (err) {
    return { events: [], error: trunc(String(err), 160) };
  }
}
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
    return { ok: null, detail: null, error: "bad repo (owner/repo)", commits: [] };
  }
  const base = `https://api.github.com/repos/${t.repo}`;
  const repoRes = await fetch(base, { headers: jsonHeaders(token) });
  if (repoRes.status === 404) {
    return { ok: false, detail: null, error: "repo not found (check repo or token scope)", commits: [] };
  }
  if (repoRes.status === 403) {
    return { ok: null, detail: null, error: await readError(repoRes), commits: [] };
  }
  if (!repoRes.ok) {
    return { ok: null, detail: null, error: `github ${repoRes.status}`, commits: [] };
  }
  const repo = (await repoRes.json()) as { default_branch?: string };
  const branch = repo.default_branch || "main";
  // 30 per check: merged into history on arrival, so a busy stretch backfills fast.
  const comRes = await fetch(`${base}/commits?sha=${encodeURIComponent(branch)}&per_page=30`, {
    headers: jsonHeaders(token),
  });
  if (comRes.status === 409 || comRes.status === 422) {
    // Empty repo / unborn branch: reachable, but no signal yet — stay unknown, no alert.
    return { ok: null, detail: `no commits on ${branch} yet`, error: null, commits: [] };
  }
  if (!comRes.ok) {
    return { ok: null, detail: null, error: `github ${comRes.status}`, commits: [] };
  }
  const rows = (await comRes.json()) as Array<{
    sha?: string;
    html_url?: string;
    parents?: unknown[];
    commit?: { message?: string; author?: { date?: string } };
  }>;
  const commits: CommitInfo[] = (rows ?? []).map((c) => ({
    sha: (c.sha ?? "").slice(0, 7),
    msg: (c.commit?.message ?? "commit").split("\n")[0].slice(0, 120),
    ts: c.commit?.author?.date ? Date.parse(c.commit.author.date) : Date.now(),
    url: c.html_url ?? null,
    merge: (c.parents?.length ?? 0) > 1,
  }));
  if (!commits.length) {
    return { ok: null, detail: `no commits on ${branch} yet`, error: null, commits: [] };
  }
  const head = commits[0];
  return {
    ok: true,
    detail: `${branch} · ${head.sha} ${head.msg}`,
    error: null,
    commits,
  };
}

async function vercelProbe(t: DeployTarget, token: string | null): Promise<DeployResult> {
  if (!token) return { ok: null, detail: null, error: "vercel not connected", commits: [] };
  if (!t.project) return { ok: null, detail: null, error: "project required", commits: [] };
  const qs = new URLSearchParams({ limit: "1", target: "production", projectId: t.project });
  if (t.team) qs.set("teamId", t.team);
  const res = await fetch(`https://api.vercel.com/v6/deployments?${qs.toString()}`, {
    headers: jsonHeaders(token),
  });
  if (res.status === 401 || res.status === 403) {
    return { ok: false, detail: null, error: await readError(res), commits: [] };
  }
  if (res.status === 404) {
    return { ok: false, detail: null, error: "project not found (check id or team)", commits: [] };
  }
  if (!res.ok) {
    return { ok: null, detail: null, error: `vercel ${res.status}`, commits: [] };
  }
  const json = (await res.json()) as {
    deployments?: Array<{ readyState?: string; url?: string; uid?: string; created?: number }>;
  };
  const dep = json.deployments?.[0];
  if (!dep) return { ok: null, detail: "no production deploys yet", error: null, commits: [] };
  const state = dep.readyState ?? "UNKNOWN";
  const label = dep.url || dep.uid || t.project;
  // The deployment itself is the ship marker — analytics reads these.
  const marker: CommitInfo | null = dep.uid
    ? {
        sha: dep.uid.slice(0, 7),
        msg: `${dep.url ?? t.project} · ${state.toLowerCase()}`,
        ts: typeof dep.created === "number" ? dep.created : Date.now(),
        url: dep.url ? `https://${dep.url}` : null,
        merge: false,
      }
    : null;
  if (state === "READY") return { ok: true, detail: `${label} · ready`, error: null, commits: marker ? [marker] : [] };
  if (state === "ERROR") return { ok: false, detail: label, error: "deploy error", commits: marker ? [marker] : [] };
  if (state === "CANCELED") return { ok: false, detail: label, error: "deploy canceled", commits: marker ? [marker] : [] };
  return { ok: true, detail: `${label} · ${state.toLowerCase()}`, error: null, commits: marker ? [marker] : [] };
}

export async function probeTarget(t: DeployTarget, env: Env): Promise<DeployResult> {
  if (t.provider === "cloudflare") {
    const { cloudflareProbe, cloudflareToken } = await import("../cloudflare/index");
    try {
      const r = await cloudflareProbe(t, await cloudflareToken(env));
      return { commits: [], ...r };
    } catch (err) {
      return { ok: null, detail: null, error: trunc(String(err), 160), commits: [] };
    }
  }
  const token =
    t.provider === "github"
      ? await getSetting(env.DB, "github_token")
      : await getSetting(env.DB, "vercel_token");
  try {
    if (t.provider === "vercel" && !t.team && t.project) {
      // Targets added without a team scope: fall back to the log-mapping team.
      const mapping = await getVercelMapping(env);
      const team = mapping[t.project]?.team ?? null;
      const r = await vercelProbe({ ...t, team }, token);
      return { commits: [], ...r };
    }
    const r = t.provider === "github" ? await githubProbe(t, token) : await vercelProbe(t, token);
    return { commits: [], ...r };
  } catch (err) {
    return { ok: null, detail: null, error: trunc(String(err), 160), commits: [] };
  }
}

const MAX_STORED_COMMITS = 100;
const COMMIT_KEEP_MS = 30 * 86400000;

/**
 * Accumulate ship history: analytics charts read last_commits, so probes must
 * merge into it (dedupe by sha, newest first, capped) instead of replacing a
 * snapshot — a burst of pushes between checks would otherwise be lost.
 */
export function mergeCommits(existingRaw: string | null, fresh: CommitInfo[], now: number): string | null {
  const bySha = new Map<string, CommitInfo>();
  for (const c of fresh) if (c?.sha) bySha.set(c.sha, c);
  try {
    const prev = JSON.parse(existingRaw ?? "[]") as CommitInfo[];
    if (Array.isArray(prev)) {
      for (const c of prev) if (c?.sha && !bySha.has(c.sha)) bySha.set(c.sha, c);
    }
  } catch {
    /* corrupt history: fresh wins */
  }
  const cutoff = now - COMMIT_KEEP_MS;
  const merged = [...bySha.values()]
    .filter((c) => (c.ts || now) >= cutoff)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, MAX_STORED_COMMITS);
  return merged.length ? JSON.stringify(merged) : null;
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
      // Infra error / no signal yet: record it, keep the previous status, no alert.
      if (r.ok === null) {
        stmts.push(
          env.DB.prepare(
            `UPDATE deploy_targets SET last_check_at = ?, last_detail = COALESCE(?, last_detail), last_error = ? WHERE id = ?`,
          ).bind(now, r.detail, r.error, t.id),
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
             consecutive = ?, last_nag_at = ?, last_commits = COALESCE(?, last_commits)
           WHERE id = ?`,
        ).bind(next, now, r.detail, r.error, consecutive, lastNag, mergeCommits(t.last_commits, r.commits ?? [], now), t.id),
      );
    }

    if (stmts.length) await env.DB.batch(stmts);
    alerts += await notifyAll(env, pending);
  }

  return { scanned: targets.length, alerts };
}

/** repo (owner/name) -> log source. `quiet` keeps only warn+error (drops info chatter). */
export type GithubLogMap = Record<string, { source: string; quiet: boolean }>;

export async function getGithubMapping(env: Env): Promise<GithubLogMap> {
  const raw = await getSetting(env.DB, "github_log_sources");
  if (!raw) return {};
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object" || Array.isArray(o)) return {};
    const out: GithubLogMap = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (typeof k !== "string" || !k || !k.includes("/")) continue;
      if (typeof v === "string" && v) out[k.slice(0, 100)] = { source: v, quiet: false };
      else if (v && typeof v === "object" && typeof (v as { source?: unknown }).source === "string") {
        const vv = v as { source: string; quiet?: unknown };
        if (vv.source) out[k.slice(0, 100)] = { source: vv.source, quiet: vv.quiet === true };
      }
    }
    return out;
  } catch {
    return {};
  }
}

export async function setGithubMapping(env: Env, mapping: Record<string, unknown>): Promise<GithubLogMap> {
  const valid = await env.DB.prepare("SELECT id FROM log_sources").all<{ id: string }>();
  const ids = new Set((valid.results ?? []).map((r) => r.id));
  const clean: GithubLogMap = {};
  for (const [k, v] of Object.entries(mapping).slice(0, 20)) {
    if (typeof k !== "string" || !k || !k.includes("/")) continue;
    const source = typeof v === "string" ? v : (v as { source?: unknown })?.source;
    const quiet = typeof v === "object" && v !== null && (v as { quiet?: unknown }).quiet === true;
    if (typeof source === "string" && ids.has(source)) {
      clean[k.slice(0, 100)] = { source, quiet };
    }
  }
  await setSetting(env.DB, "github_log_sources", JSON.stringify(clean));
  return clean;
}

export type GithubActionEvent = { ts: number; level: string; message: string; repo: string };

function classifyGithubLevel(text: string): string {
  if (/warn/i.test(text)) return "warn";
  if (/err(or)?|fail(ed|ure)?|fatal|exception|timed_?out|cancel[l]?ed|denied|not found|E[A-Z]+|panic/i.test(text)) return "error";
  return "info";
}

type GhRun = {
  id?: number;
  name?: string;
  display_title?: string;
  head_branch?: string;
  head_sha?: string;
  run_number?: number;
  status?: string;
  conclusion?: string | null;
  created_at?: string;
  updated_at?: string;
  html_url?: string;
};

type GhJob = {
  id?: number;
  name?: string;
  conclusion?: string | null;
  started_at?: string;
  completed_at?: string;
  html_url?: string;
};

function githubActionsError(status: number, msg: string): string {
  if (status === 401 || status === 403) {
    if (/resource not accessible|actions/i.test(msg)) return "token rejected (needs Actions: read)";
    return "token rejected";
  }
  if (status === 404) return "repo not found or Actions disabled";
  return trunc(msg || `github ${status}`, 160);
}

/** Recent Actions runs of one repo, newest first — run markers plus failed-job log lines. */
export async function queryGithubActionsLogs(
  env: Env,
  repo: string,
  limit = 25,
): Promise<{ events: GithubActionEvent[]; error: string | null }> {
  const token = await getSetting(env.DB, "github_token");
  if (!token) return { events: [], error: "github not connected" };
  if (!repo.includes("/")) return { events: [], error: "bad repo (owner/repo)" };
  const base = `https://api.github.com/repos/${repo}`;
  let runs: GhRun[];
  try {
    const res = await fetch(`${base}/actions/runs?per_page=5`, { headers: jsonHeaders(token) });
    if (!res.ok) return { events: [], error: githubActionsError(res.status, await readError(res)) };
    const json = (await res.json()) as { workflow_runs?: GhRun[] };
    runs = Array.isArray(json.workflow_runs) ? json.workflow_runs : [];
  } catch (err) {
    return { events: [], error: trunc(String(err), 160) };
  }
  if (!runs.length) return { events: [], error: null };
  const events: GithubActionEvent[] = [];
  const failed = runs.filter((r) =>
    ["failure", "timed_out", "cancelled", "action_required", "stale"].includes(String(r.conclusion ?? "")),
  );
  for (const r of runs.slice(0, 5)) {
    const conclusion = String(r.conclusion ?? r.status ?? "unknown");
    const title = String(r.display_title ?? r.name ?? "workflow").slice(0, 120);
    events.push({
      ts: (r.updated_at && Date.parse(r.updated_at)) || (r.created_at && Date.parse(r.created_at)) || Date.now(),
      level: /fail|timed_out|cancelled|action_required|stale/i.test(conclusion) ? "error" : "info",
      message: `[github] ${r.name ?? "workflow"} #${r.run_number ?? r.id} ${conclusion} · ${r.head_branch ?? ""} ${(r.head_sha ?? "").slice(0, 7)} ${title}`.slice(0, 300),
      repo,
    });
  }
  // Expand at most 2 failed runs: failed jobs -> log text tail. Keeps the
  // subrequest count bounded (1 runs + 2 jobs + 2-4 logs per repo per sync).
  for (const r of failed.slice(0, 2)) {
    if (!r.id || events.length >= limit) break;
    let jobs: GhJob[];
    try {
      const res = await fetch(`${base}/actions/runs/${r.id}/jobs?per_page=20`, { headers: jsonHeaders(token) });
      if (!res.ok) continue;
      const json = (await res.json()) as { jobs?: GhJob[] };
      jobs = Array.isArray(json.jobs) ? json.jobs : [];
    } catch {
      continue;
    }
    const bad = jobs.filter((j) => j.conclusion && j.conclusion !== "success").slice(0, 2);
    const targets = bad.length ? bad : jobs.filter((j) => j.id).slice(0, 1);
    for (const j of targets) {
      if (!j.id || events.length >= limit) break;
      try {
        const res = await fetch(`${base}/actions/jobs/${j.id}/logs`, {
          headers: { ...jsonHeaders(token), accept: "text/plain" },
          redirect: "follow",
        });
        if (!res.ok) continue;
        const text = await res.text().catch(() => "");
        if (!text) continue;
        const lines = text.split("\n").slice(-120);
        // Prefer error/warn lines, then the tail — capped so one repo fills at most `limit`.
        const interesting = lines.filter((l) => /err(or)?|fail|fatal|exception|timed_?out|warn|denied|panic/i.test(l));
        const picked = [...interesting.slice(-12), ...lines.slice(-8)];
        const seen = new Set<string>();
        const tsBase = (j.completed_at && Date.parse(j.completed_at)) || (r.updated_at && Date.parse(r.updated_at)) || Date.now();
        let i = 0;
        for (const rawLine of picked) {
          const line = rawLine.replace(/^\d{4}-\d{2}-\d{2}T\S+\s*/, "").trim().slice(0, 280);
          if (!line || seen.has(line)) continue;
          seen.add(line);
          events.push({
            ts: tsBase - (picked.length - i) * 1000,
            level: classifyGithubLevel(line),
            message: `[github] ${r.name ?? "workflow"} ${j.name ?? "job"}: ${line}`.slice(0, 300),
            repo,
          });
          i++;
          if (events.length >= limit) break;
        }
      } catch {
        continue;
      }
    }
  }
  return { events: events.slice(0, limit), error: null };
}

const GITHUB_LOG_EVERY_MS = 5 * 60 * 1000;
const GITHUB_LOG_CAP = 25;

/**
 * Background sync: pull Actions runs of mapped repos into log_events (D1).
 * Throttled to every 5 min; the UNIQUE (source_id, ts, message) index makes
 * re-pulls idempotent, so no per-repo cursors are needed.
 */
export async function syncGithubLogs(env: Env, now: number): Promise<number> {
  const mapping = await getGithubMapping(env);
  const repos = Object.keys(mapping).slice(0, 5);
  if (!repos.length) return 0;
  const last = Number((await getSetting(env.DB, "github_log_poll_at")) ?? 0);
  if (now - last < GITHUB_LOG_EVERY_MS) return 0;
  let synced = 0;
  let firstError: string | null = null;
  for (const repo of repos) {
    const pref = mapping[repo];
    const sid = typeof pref === "string" ? pref : pref?.source;
    if (!sid) continue;
    const quiet = typeof pref === "object" && pref !== null && pref.quiet === true;
    const { events, error } = await queryGithubActionsLogs(env, repo, GITHUB_LOG_CAP).catch(() => ({
      events: [],
      error: "failed" as string | null,
    }));
    if (error && !firstError) firstError = `${repo.slice(0, 40)}: ${error}`;
    // Tag every line with its repo so mixed sources stay readable; quiet
    // keeps warn+error (drops info chatter and green-run markers).
    const kept = quiet ? events.filter((e) => e.level !== "info") : events;
    synced += await putLogEvents(
      env,
      sid,
      kept.map((e) => ({
        ts: e.ts,
        level: e.level,
        message: e.message.replace(/^\[github\] /, `[github:${repo}] `),
        data: { repo, message: e.message },
      })),
    ).catch(() => 0);
  }
  await setSetting(env.DB, "github_log_poll_at", String(now)).catch(() => {});
  await setSetting(env.DB, "github_log_last", JSON.stringify({ at: now, synced, error: firstError })).catch(
    () => {},
  );
  return synced;
}

/** JSON for storage on first insert (no history to merge yet). */
function commitsJson(r: DeployResult): string | null {
  return r.commits?.length ? JSON.stringify(r.commits) : null;
}

const VERCEL_LOG_EVERY_MS = 5 * 60 * 1000;
const VERCEL_LOG_CAP = 25;

/**
 * Background sync: pull runtime logs of mapped Vercel projects into log_events
 * (D1). Throttled to every 5 min; the UNIQUE (source_id, ts, message) index
 * makes re-pulls idempotent, so no per-project timestamp cursors are needed.
 */
export async function syncVercelLogs(env: Env, now: number): Promise<number> {
  const mapping = await getVercelMapping(env);
  const pids = Object.keys(mapping).slice(0, 5);
  if (!pids.length) return 0;
  const last = Number((await getSetting(env.DB, "vercel_log_poll_at")) ?? 0);
  if (now - last < VERCEL_LOG_EVERY_MS) return 0;
  const teamRows = await env.DB.prepare(
    "SELECT project, team, name FROM deploy_targets WHERE provider = 'vercel'",
  ).all<{ project: string | null; team: string | null; name: string | null }>();
  const teamByProject = new Map(
    (teamRows.results ?? []).filter((r) => r.project).map((r) => [r.project as string, r.team]),
  );
  const nameByProject = new Map(
    (teamRows.results ?? []).filter((r) => r.project).map((r) => [r.project as string, r.name ?? r.project as string]),
  );
  let synced = 0;
  let firstError: string | null = null;
  for (const pid of pids) {
    const entry = mapping[pid];
    const sid = typeof entry === "string" ? entry : entry?.source;
    if (!sid) continue;
    const quiet = typeof entry === "object" && entry !== null && entry.quiet === true;
    const label = (nameByProject.get(pid) ?? pid).slice(0, 40);
    const team =
      (typeof entry === "object" && entry !== null ? entry.team : null) ??
      teamByProject.get(pid) ??
      null;
    const { events, error } = await queryVercelLogs(env, pid, team, VERCEL_LOG_CAP).catch(() => ({
      events: [],
      error: "failed" as string | null,
    }));
    if (error && !firstError) firstError = `${pid.slice(0, 16)}: ${error}`;
    const kept = quiet ? events.filter((e) => e.level !== "info") : events;
    synced += await putLogEvents(
      env,
      sid,
      kept.map((e) => ({
        ts: e.ts,
        level: e.level,
        message: `[vercel:${label}] ${e.message}`,
        data: { project: pid, label, message: e.message },
      })),
    ).catch(() => 0);
  }
  await setSetting(env.DB, "vercel_log_poll_at", String(now)).catch(() => {});
  await setSetting(env.DB, "vercel_log_last", JSON.stringify({ at: now, synced, error: firstError })).catch(
    () => {},
  );
  return synced;
}

/** Insert a target with its first real check result so the status page is truthful immediately. */export async function insertDeployTarget(env: Env, t: DeployTarget): Promise<void> {
  const first = await probeTarget(t, env);
  const status: "up" | "down" | "unknown" =
    first.ok == null ? "unknown" : first.ok ? "up" : "down";
  await env.DB.prepare(
    `INSERT INTO deploy_targets (
       id, provider, name, repo, project, team, interval_min, enabled, status,
       last_check_at, last_detail, last_error, consecutive, mute_until, nag_min,
       last_nag_at, created_at, site_id, last_commits, account
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL, ?, ?, ?, ?)`,
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
      t.site_id,
      commitsJson(first),
      t.account,
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
  targets: Array<DeployTarget & { commits: CommitInfo[] }>;
  sites: Array<{ id: string; name: string }>;
  github: { connected: boolean; who: string | null };
  vercel: { connected: boolean; who: string | null };
  cloudflare: { connected: boolean; who: string | null };
}> {
  const [targets, githubUser, vercelUser, cloudflareUser, sites] = await Promise.all([
    listDeployTargets(env),
    getSetting(env.DB, "github_user"),
    getSetting(env.DB, "vercel_user"),
    getSetting(env.DB, "cloudflare_user"),
    env.DB.prepare("SELECT id, name FROM analytics_sites ORDER BY created_at ASC").all<{
      id: string;
      name: string;
    }>(),
  ]);
  return {
    targets: targets.map((t) => ({ ...t, commits: parseCommits(t.last_commits) })),
    sites: sites.results ?? [],
    github: { connected: githubUser != null, who: githubUser },
    vercel: { connected: vercelUser != null, who: vercelUser },
    cloudflare: { connected: cloudflareUser != null, who: cloudflareUser },
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
       status = ?, last_check_at = ?, last_detail = ?, last_error = ?, consecutive = ?,
       last_commits = COALESCE(?, last_commits)
     WHERE id = ?`,
  )
    .bind(next, Date.now(), r.detail, r.error, consecutive, mergeCommits(t.last_commits, r.commits ?? [], Date.now()), t.id)
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
         last_nag_at, created_at, site_id, last_commits, account
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL, ?, ?, ?, ?)`,
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
      t.site_id,
      commitsJson(first),
      t.account,
    );
  });
  await env.DB.batch(stmts);
  return targets.length;
}
