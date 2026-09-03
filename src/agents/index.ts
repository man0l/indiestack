export const MAX_AGENT_TOKENS = 5;

export type AgentToken = {
  id: string;
  name: string;
  token: string;
  enabled: number;
  last_used_at: number | null;
  created_at: number;
};

export async function listAgentTokens(db: D1Database): Promise<AgentToken[]> {
  const { results } = await db
    .prepare("SELECT * FROM agent_tokens ORDER BY created_at ASC")
    .all<AgentToken>();
  return results ?? [];
}

async function touchToken(env: Env, t: AgentToken): Promise<void> {
  const now = Date.now();
  if (t.last_used_at != null && now - t.last_used_at < 60_000) return;
  await env.DB.prepare("UPDATE agent_tokens SET last_used_at = ? WHERE id = ?")
    .bind(now, t.id)
    .run()
    .catch(() => {});
}

async function agentByToken(env: Env, token: string): Promise<AgentToken | null> {
  const rec = await env.DB.prepare("SELECT * FROM agent_tokens WHERE token = ? AND enabled = 1")
    .bind(token)
    .first<AgentToken>();
  return rec ?? null;
}

function bearerToken(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return null;
}

/** Resolve the caller: Bearer header first, then ?token= for curl-friendly agents. */
async function authorize(env: Env, request: Request, url: URL): Promise<AgentToken | null> {
  const fromHeader = bearerToken(request);
  if (fromHeader) return agentByToken(env, fromHeader);
  const fromQuery = url.searchParams.get("token");
  if (fromQuery) return agentByToken(env, fromQuery);
  return null;
}

// ---------------------------------------------------------------- agents.md

export function agentsMarkdown(env: Env, origin: string): string {
  const name = env.APP_NAME;
  return `# ${name} — agent guide

This Worker is a self-hosted ops stack owned by an indie hacker: uptime monitors,
cron heartbeats, log ingest, a public status page, site analytics, and deploy
monitoring (GitHub / Vercel). One Worker, one owner, on Cloudflare.

All data lives in the owner's own D1 and R2. Read access for agents is granted
with an **agent token** minted by the owner in \`/admin\`.

## Human pages

- \`GET /\` — public status page (HTML)
- \`GET /admin\` — owner only (token-gated)

## Public endpoints (no auth)

- \`GET /health\` — "up" or "down" (503 when anything is down)
- \`GET /health.json\` — \`{ ok, up, down, unknown, checked }\`

## Agent endpoints (Authorization: Bearer <agent-token>)

- \`GET ${origin}/agents.md\` — this file
- \`GET ${origin}/agent/status.json\` — full snapshot: monitors, heartbeats, deploys, last-24h incidents, analytics summary

## MCP (streamable HTTP, stateless)

- \`POST ${origin}/mcp/<agent-token>\` — JSON-RPC 2.0. Tools:
  \`get_overview\`, \`list_monitors\`, \`list_heartbeats\`, \`list_deploys\`,
  \`recent_incidents\`, \`get_analytics\`.
- \`GET ${origin}/mcp/<agent-token>\` → 405 (no SSE; POST only)

## Ingest (owner's tokens, per source)

- \`GET|POST /beat/<job-token>\` — cron heartbeat. Silence past interval + grace alerts.
- \`POST /log/<source-token>\` — JSON body (8KB max), kept 24h in R2.

## Etiquette

- Everything above the ingest section is read-only. Do not retry aggressively;
  poll at most once a minute. The owner sees last-used times per token.
- Prices and claims: this is the owner's own infra on the Cloudflare free plan.
`;
}

// ------------------------------------------------------------- agent status

export async function statusSnapshot(env: Env, origin: string): Promise<Record<string, unknown>> {
  const now = Date.now();
  const since = now - 24 * 60 * 60 * 1000;
  const [monitors, jobs, deploys, incidents, analytics] = await Promise.all([
    env.DB.prepare(
      `SELECT name, url, status, interval_min, last_status_code, last_latency_ms, last_error, last_check_at
       FROM monitors ORDER BY created_at ASC`,
    ).all(),
    env.DB.prepare(
      `SELECT name, status, interval_min, grace_min, last_beat_at, last_error
       FROM jobs ORDER BY created_at ASC`,
    ).all(),
    env.DB.prepare(
      `SELECT name, provider, repo, project, status, last_detail, last_error, last_check_at
       FROM deploy_targets ORDER BY created_at ASC`,
    ).all(),
    env.DB.prepare(
      `SELECT c.ts, m.name, c.error
       FROM checks c JOIN monitors m ON m.id = c.monitor_id
       WHERE c.ok = 0 AND c.ts >= ? ORDER BY c.ts DESC LIMIT 20`,
    )
      .bind(since)
      .all(),
    analyticsSummary(env, now, 7),
  ]);
  const rows = (monitors.results ?? []) as Array<Record<string, unknown>>;
  const up = rows.filter((m) => m.status === "up").length;
  const down = rows.filter((m) => m.status === "down").length;
  return {
    worker: origin,
    generated_at: new Date(now).toISOString(),
    monitors: { up, down, total: rows.length, items: monitors.results ?? [] },
    heartbeats: jobs.results ?? [],
    deploys: deploys.results ?? [],
    incidents_24h: (incidents.results ?? []).map((r) => {
      const row = r as { ts: number; name: string; error: string | null };
      return { at: new Date(row.ts).toISOString(), monitor: row.name, error: row.error };
    }),
    analytics: analytics,
  };
}

async function analyticsSummary(env: Env, now: number, days: number): Promise<unknown> {
  const sinceDay = new Date(now - days * 86400000).toISOString().slice(0, 10);
  const sites = await env.DB.prepare(
    "SELECT name FROM analytics_sites WHERE enabled = 1 ORDER BY created_at ASC",
  ).all<{ name: string }>();
  const totals = await env.DB.prepare(
    `SELECT s.name AS site, COUNT(*) AS views, COUNT(DISTINCT h.vid) AS uniques,
            COUNT(DISTINCT h.path) AS paths
     FROM hits h JOIN analytics_sites s ON s.id = h.site_id
     WHERE h.day >= ? GROUP BY s.id ORDER BY views DESC`,
  )
    .bind(sinceDay)
    .all<{ site: string; views: number; uniques: number; paths: number }>();
  return {
    window_days: days,
    note: "uniques are per-day buckets (visitor hash rotates daily)",
    sites: sites.results?.map((s) => s.name) ?? [],
    totals: totals.results ?? [],
  };
}

// ---------------------------------------------------------------------- MCP

type JsonRpcId = string | number | null;
type JsonRpcRequest = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
};
type JsonRpcResult = { jsonrpc: "2.0"; id: JsonRpcId; result: Record<string, unknown> };
type JsonRpcErr = { jsonrpc: "2.0"; id: JsonRpcId; error: { code: number; message: string } };

const PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_VERSIONS = new Set(["2025-06-18", "2025-03-26", "2024-11-05"]);

function rpcResult(id: JsonRpcId, result: Record<string, unknown>): JsonRpcResult {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: JsonRpcId, code: number, message: string): JsonRpcErr {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

const TOOLS: Array<Record<string, unknown>> = [
  {
    name: "get_overview",
    description: "Overall health of the owner's stack: monitor up/down counts and 24h uptime percentage.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_monitors",
    description: "Every uptime monitor with status, last status code, latency and error.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_heartbeats",
    description: "Cron heartbeat jobs: status, interval, grace, last beat time.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_deploys",
    description: "GitHub / Vercel deployment monitors the owner connected, with last deploy state.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "recent_incidents",
    description: "Failed monitor checks, newest first.",
    inputSchema: {
      type: "object",
      properties: { hours: { type: "number", description: "lookback window, default 24, max 168" } },
      additionalProperties: false,
    },
  },
  {
    name: "get_analytics",
    description: "Site analytics collected by this Worker: views per site and top paths.",
    inputSchema: {
      type: "object",
      properties: { days: { type: "number", description: "window, default 7, max 30" } },
      additionalProperties: false,
    },
  },
];

async function callTool(env: Env, name: string, args: Record<string, unknown>): Promise<unknown> {
  const now = Date.now();
  switch (name) {
    case "get_overview": {
      const since = now - 86400000;
      const [m, j, d, pct] = await Promise.all([
        env.DB.prepare(
          "SELECT status, COUNT(*) AS n FROM monitors GROUP BY status",
        ).all<{ status: string; n: number }>(),
        env.DB.prepare("SELECT status, COUNT(*) AS n FROM jobs GROUP BY status").all<{
          status: string;
          n: number;
        }>(),
        env.DB.prepare("SELECT status, COUNT(*) AS n FROM deploy_targets GROUP BY status").all<{
          status: string;
          n: number;
        }>(),
        env.DB.prepare("SELECT COUNT(*) AS n, SUM(ok) AS ok_n FROM checks WHERE ts >= ?")
          .bind(since)
          .first<{ n: number; ok_n: number | null }>(),
      ]);
      const byStatus = (rows: Array<{ status: string; n: number }>) => {
        const out: Record<string, number> = {};
        for (const r of rows) out[r.status] = Number(r.n);
        return out;
      };
      const checks = Number(pct?.n) || 0;
      const ok = Number(pct?.ok_n) || 0;
      return {
        monitors: byStatus(m.results ?? []),
        heartbeats: byStatus(j.results ?? []),
        deploys: byStatus(d.results ?? []),
        uptime_24h_pct: checks ? Math.round((ok / checks) * 1000) / 10 : null,
      };
    }
    case "list_monitors": {
      const { results } = await env.DB.prepare(
        `SELECT name, url, status, interval_min, last_status_code, last_latency_ms,
                last_error, last_check_at, enabled
         FROM monitors ORDER BY created_at ASC`,
      ).all();
      return decorateTimes(results ?? [], ["last_check_at"]);
    }
    case "list_heartbeats": {
      const { results } = await env.DB.prepare(
        `SELECT name, status, interval_min, grace_min, last_beat_at, last_error, enabled
         FROM jobs ORDER BY created_at ASC`,
      ).all();
      return decorateTimes(results ?? [], ["last_beat_at"]);
    }
    case "list_deploys": {
      const { results } = await env.DB.prepare(
        `SELECT name, provider, repo, project, status, last_detail, last_error, last_check_at, enabled
         FROM deploy_targets ORDER BY created_at ASC`,
      ).all();
      return decorateTimes(results ?? [], ["last_check_at"]);
    }
    case "recent_incidents": {
      const hours = clampNum(args.hours, 1, 168, 24);
      const { results } = await env.DB.prepare(
        `SELECT c.ts, m.name, c.error
         FROM checks c JOIN monitors m ON m.id = c.monitor_id
         WHERE c.ok = 0 AND c.ts >= ? ORDER BY c.ts DESC LIMIT 50`,
      )
        .bind(now - hours * 3600000)
        .all<{ ts: number; name: string; error: string | null }>();
      return (results ?? []).map((r) => ({
        at: new Date(r.ts).toISOString(),
        monitor: r.name,
        error: r.error,
      }));
    }
    case "get_analytics": {
      const days = clampNum(args.days, 1, 30, 7);
      const totals = await analyticsSummary(env, now, days);
      const sinceDay = new Date(now - days * 86400000).toISOString().slice(0, 10);
      const top = await env.DB.prepare(
        `SELECT s.name AS site, h.path, COUNT(*) AS views, COUNT(DISTINCT h.vid) AS uniques
         FROM hits h JOIN analytics_sites s ON s.id = h.site_id
         WHERE h.day >= ?
         GROUP BY s.id, h.path ORDER BY views DESC LIMIT 10`,
      )
        .bind(sinceDay)
        .all();
      return { window_days: days, totals, top_paths: top.results ?? [] };
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

function clampNum(v: unknown, min: number, max: number, dflt: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function decorateTimes(rows: Array<Record<string, unknown>>, keys: string[]): unknown[] {
  return rows.map((r) => {
    const out = { ...r };
    for (const k of keys) {
      const ts = r[k];
      if (typeof ts === "number") out[`${k}_iso`] = new Date(ts).toISOString();
    }
    return out;
  });
}

function textResult(id: JsonRpcId, data: unknown): JsonRpcResult {
  return rpcResult(id, {
    content: [{ type: "text", text: JSON.stringify(data, null, 1) }],
  });
}

async function handleRpcMessage(
  env: Env,
  msg: JsonRpcRequest,
): Promise<JsonRpcResult | JsonRpcErr | null> {
  const id = msg.id ?? null;
  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return rpcError(id, -32600, "Invalid Request");
  }
  // Notifications carry no id: handle silently.
  if (msg.id === undefined) return null;

  switch (msg.method) {
    case "initialize": {
      const requested = msg.params?.protocolVersion;
      const version =
        typeof requested === "string" && SUPPORTED_VERSIONS.has(requested)
          ? requested
          : PROTOCOL_VERSION;
      return rpcResult(id, {
        protocolVersion: version,
        capabilities: { tools: {} },
        serverInfo: { name: "indiestack", title: "IndieStack ops", version: "0.1.0" },
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: TOOLS });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const args = (msg.params?.arguments as Record<string, unknown> | undefined) ?? {};
      try {
        return textResult(id, await callTool(env, name, args));
      } catch (err) {
        return rpcResult(id, {
          content: [{ type: "text", text: truncErr(err) }],
          isError: true,
        });
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${msg.method}`);
  }
}

function truncErr(err: unknown): string {
  const s = String(err);
  return s.length <= 200 ? s : `${s.slice(0, 200)}…`;
}

export async function handleMcp(
  env: Env,
  token: string,
  request: Request,
): Promise<Response> {
  const agent = await agentByToken(env, token);
  if (!agent) {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "invalid token" } },
      { status: 401 },
    );
  }
  if (request.method !== "POST") {
    return new Response("MCP is POST-only JSON-RPC (streamable HTTP, stateless). See /agents.md", {
      status: 405,
      headers: { allow: "POST" },
    });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(rpcError(null, -32700, "Parse error"), { status: 400 });
  }
  await touchToken(env, agent);

  if (Array.isArray(body)) {
    const handled = await Promise.all(
      body.map((msg) => handleRpcMessage(env, msg as JsonRpcRequest)),
    );
    const responses = handled.filter((r): r is JsonRpcResult | JsonRpcErr => r !== null);
    if (responses.length === 0) return new Response(null, { status: 202 });
    return Response.json(responses);
  }
  const response = await handleRpcMessage(env, body as JsonRpcRequest);
  if (response === null) return new Response(null, { status: 202 });
  return Response.json(response);
}

/** GET /agent/status.json — Bearer agent token. */
export async function handleAgentStatus(env: Env, request: Request, url: URL): Promise<Response> {
  const agent = await authorize(env, request, url);
  if (!agent) {
    return Response.json(
      { ok: false, error: "invalid agent token" },
      { status: 401 },
    );
  }
  await touchToken(env, agent);
  const snapshot = await statusSnapshot(env, url.origin);
  return Response.json(snapshot, {
    headers: { "cache-control": "no-store" },
  });
}
