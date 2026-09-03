import { getSetting } from "../kernel/db";
import { trunc } from "../kernel/util";

export const MAX_WATCHERS = 10;
const POLL_EVERY_MS = 15 * 60 * 1000;
const UA = "indiestack-signals/0.1";

export type Watcher = {
  id: string;
  site_id: string;
  source: "github" | "x" | "reddit";
  query: string;
  last_poll_at: number | null;
  last_status: string | null;
  created_at: number;
};

export type Signal = {
  id: string;
  site_id: string;
  watcher_id: string;
  source: string;
  kind: string;
  title: string;
  url: string | null;
  author: string | null;
  external_id: string | null;
  ts: number;
  created_at: number;
};

export type FetchedSignal = {
  kind: string;
  title: string;
  url: string | null;
  author: string | null;
  external_id: string;
  ts: number;
};

async function storeSignals(
  env: Env,
  watcher: Watcher,
  found: FetchedSignal[],
): Promise<number> {
  let added = 0;
  for (const s of found.slice(0, 10)) {
    const res = await env.DB.prepare(
      `INSERT OR IGNORE INTO signals (
         id, site_id, watcher_id, source, kind, title, url, author, external_id, ts, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        watcher.site_id,
        watcher.id,
        watcher.source,
        s.kind,
        trunc(s.title, 200),
        s.url,
        s.author,
        s.external_id,
        s.ts,
        Date.now(),
      )
      .run();
    added += (res.meta.changes ?? 0) > 0 ? 1 : 0;
  }
  return added;
}

// ------------------------------------------------------------- GitHub

async function pollGithub(env: Env, watcher: Watcher): Promise<string> {
  const m = watcher.query.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!m) return "query must be owner/repo";
  const token = await getSetting(env.DB, "github_token");
  const since = new Date((watcher.last_poll_at ?? Date.now() - 24 * 3600_000)).toISOString();
  const headers: Record<string, string> = { accept: "application/json", "user-agent": UA };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(
    `https://api.github.com/repos/${m[1]}/${m[2]}/commits?since=${encodeURIComponent(since)}&per_page=5`,
    { headers },
  );
  if (!res.ok) return `github ${res.status}`;
  const commits = (await res.json()) as Array<{
    sha?: string;
    html_url?: string;
    commit?: { message?: string; author?: { name?: string; date?: string } };
  }>;
  const found: FetchedSignal[] = (commits ?? []).map((c) => ({
    kind: "commit",
    title: trunc((c.commit?.message ?? "commit").split("\n")[0], 120),
    url: c.html_url ?? null,
    author: c.commit?.author?.name ?? null,
    external_id: c.sha ?? crypto.randomUUID(),
    ts: c.commit?.author?.date ? Date.parse(c.commit.author.date) : Date.now(),
  }));
  const added = await storeSignals(env, watcher, found);
  return added > 0 ? `ok · ${added} new` : "ok";
}

// ----------------------------------------------------------------- X

async function pollX(env: Env, watcher: Watcher): Promise<string> {
  const bearer = await getSetting(env.DB, "signals_x_bearer");
  if (!bearer) return "no X bearer key configured";
  const qs = new URLSearchParams({
    query: `${watcher.query} -is:retweet`,
    max_results: "10",
    "tweet.fields": "created_at",
    expansions: "author_id",
    "user.fields": "username",
  });
  const res = await fetch(`https://api.twitter.com/2/tweets/search/recent?${qs}`, {
    headers: { authorization: `Bearer ${bearer}` },
  });
  if (res.status === 429) return "X rate limited";
  if (!res.ok) return `x ${res.status}`;
  const json = (await res.json()) as {
    data?: Array<{ id: string; text: string; created_at?: string; author_id?: string }>;
    includes?: { users?: Array<{ id: string; username: string }> };
  };
  const users = new Map((json.includes?.users ?? []).map((u) => [u.id, u.username]));
  const found: FetchedSignal[] = (json.data ?? []).map((t) => {
    const handle = t.author_id ? users.get(t.author_id) : undefined;
    return {
      kind: "mention",
      title: t.text,
      url: handle ? `https://x.com/${handle}/status/${t.id}` : null,
      author: handle ? `@${handle}` : null,
      external_id: `x-${t.id}`,
      ts: t.created_at ? Date.parse(t.created_at) : Date.now(),
    };
  });
  const added = await storeSignals(env, watcher, found);
  return added > 0 ? `ok · ${added} new` : "ok";
}

// ------------------------------------------------------------- Reddit

let redditToken: { token: string; expires: number } | null = null;

async function redditAccessToken(env: Env): Promise<string | null> {
  const id = await getSetting(env.DB, "signals_reddit_client_id");
  const secret = await getSetting(env.DB, "signals_reddit_client_secret");
  if (!id || !secret) return null;
  if (redditToken && Date.now() < redditToken.expires - 60_000) return redditToken.token;
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      authorization: `Basic ${btoa(`${id}:${secret}`)}`,
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": UA,
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) return null;
  redditToken = {
    token: json.access_token,
    expires: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  return redditToken.token;
}

async function pollReddit(env: Env, watcher: Watcher): Promise<string> {
  const token = await redditAccessToken(env);
  if (!token) return "no Reddit client id/secret configured";
  const qs = new URLSearchParams({ q: watcher.query, sort: "new", limit: "10" });
  const res = await fetch(`https://oauth.reddit.com/search?${qs}`, {
    headers: { authorization: `Bearer ${token}`, "user-agent": UA },
  });
  if (res.status === 429) return "Reddit rate limited";
  if (!res.ok) return `reddit ${res.status}`;
  const json = (await res.json()) as {
    data?: {
      children?: Array<{
        data?: {
          id?: string;
          title?: string;
          permalink?: string;
          author?: string;
          created_utc?: number;
          subreddit?: string;
        };
      }>;
    };
  };
  const found: FetchedSignal[] = (json.data?.children ?? [])
    .map((c) => c.data)
    .filter((d): d is NonNullable<typeof d> => Boolean(d?.id))
    .map((d) => ({
      kind: "mention",
      title: `r/${d.subreddit ?? "??"} · ${d.title ?? ""}`,
      url: d.permalink ? `https://www.reddit.com${d.permalink}` : null,
      author: d.author ?? null,
      external_id: `rd-${d.id}`,
      ts: d.created_utc ? Math.round(d.created_utc * 1000) : Date.now(),
    }));
  const added = await storeSignals(env, watcher, found);
  return added > 0 ? `ok · ${added} new` : "ok";
}

export async function pollWatcher(env: Env, watcher: Watcher): Promise<string> {
  try {
    if (watcher.source === "github") return await pollGithub(env, watcher);
    if (watcher.source === "x") return await pollX(env, watcher);
    return await pollReddit(env, watcher);
  } catch (err) {
    return trunc(String(err), 120);
  }
}

export async function dueWatchers(env: Env, now: number): Promise<Watcher[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM signal_watchers
     WHERE last_poll_at IS NULL OR last_poll_at + ? <= ?`,
  )
    .bind(POLL_EVERY_MS, now)
    .all<Watcher>();
  return results ?? [];
}

export async function listWatchers(db: D1Database): Promise<Watcher[]> {
  const { results } = await db
    .prepare("SELECT * FROM signal_watchers ORDER BY created_at ASC")
    .all<Watcher>();
  return results ?? [];
}

export async function listSignals(db: D1Database, limit = 20): Promise<Signal[]> {
  const { results } = await db
    .prepare("SELECT * FROM signals ORDER BY ts DESC LIMIT ?")
    .bind(limit)
    .all<Signal>();
  return results ?? [];
}
