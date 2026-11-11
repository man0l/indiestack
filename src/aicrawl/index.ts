import { getSetting } from "../kernel/db";

export const MAX_CRAWLS_PER_SITE_DAY = 5000;
const KEEP_DAYS = 30;

/** UA patterns → vendor. Order matters: specific before generic. */
const VENDORS: Array<[RegExp, string]> = [
  [/GPTBot/i, "openai-gptbot"],
  [/OAI-SearchBot/i, "openai-searchbot"],
  [/ChatGPT-User/i, "openai-chatgpt-user"],
  [/ClaudeBot/i, "anthropic-claudebot"],
  [/Claude-User/i, "anthropic-claude-user"],
  [/Claude-SearchBot/i, "anthropic-claude-searchbot"],
  [/anthropic-ai/i, "anthropic"],
  [/PerplexityBot/i, "perplexity-bot"],
  [/Perplexity-User/i, "perplexity-user"],
  [/YouBot/i, "youbot"],
  [/Google-Extended/i, "google-extended"],
  [/GoogleOther/i, "google-other"],
  [/Applebot-Extended/i, "apple-extended"],
  [/meta-externalagent/i, "meta-externalagent"],
  [/FacebookBot/i, "meta-facebookbot"],
  [/Bytespider/i, "bytedance-bytespider"],
  [/Amazonbot/i, "amazonbot"],
  [/CCBot/i, "common-crawl"],
  [/Diffbot/i, "diffbot"],
  [/cohere-ai/i, "cohere"],
  [/img2dataset/i, "img2dataset"],
];

export function classifyCrawler(ua: string): string | null {
  if (!ua) return null;
  for (const [re, vendor] of VENDORS) {
    if (re.test(ua)) return vendor;
  }
  // Generic bots are recorded as "other-bot" so the owner still sees them.
  if (/(bot|crawler|spider|slurp|crawl)/i.test(ua)) return "other-bot";
  return null;
}

/** AI products that send human referrals — visible in the referrer of a hit. */
const AI_REFERRERS = [
  "chatgpt.com",
  "chat.openai.com",
  "perplexity.ai",
  "gemini.google.com",
  "claude.ai",
  "copilot.microsoft.com",
  "poe.com",
  "codeium.com",
  "phind.com",
];

export function isAiReferrer(ref: string | null | undefined): boolean {
  if (!ref) return false;
  const host = ref.toLowerCase();
  return AI_REFERRERS.some((h) => host === h || host.endsWith(`.${h}`));
}

export type CrawlRow = {
  vendor: string;
  n: number;
  last_ts: number;
};

export async function crawlSummary(
  env: Env,
  siteId: string,
  days = 30,
): Promise<{ byVendor: CrawlRow[]; topPaths: Array<{ path: string; n: number }>; referrals: Array<{ ref: string; views: number }> }> {
  const sinceDay = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  // Legacy /crawlers/<token> middleware rows plus indiestack-ai-bots package rows.
  const allCrawls = `(SELECT vendor, path, ts FROM crawls WHERE site_id = ?1 AND day >= ?2
     UNION ALL SELECT crawler AS vendor, path, ts FROM crawler_fetches WHERE site_id = ?1 AND day >= ?2)`;
  const [byVendor, topPaths, referrals] = await env.DB.batch([
    env.DB.prepare(
      `SELECT vendor, COUNT(*) AS n, MAX(ts) AS last_ts
       FROM ${allCrawls} GROUP BY vendor ORDER BY n DESC`,
    ).bind(siteId, sinceDay),
    env.DB.prepare(
      `SELECT path, COUNT(*) AS n FROM ${allCrawls}
       GROUP BY path ORDER BY n DESC LIMIT 8`,
    ).bind(siteId, sinceDay),
    // AI referrals come from the analytics base: hits whose referrer is an AI product.
    env.DB.prepare(
      `SELECT ref, COUNT(*) AS views FROM hits
       WHERE site_id = ? AND day >= ? AND ref IS NOT NULL AND (
         ${AI_REFERRERS.map((h) => `ref = '${h}' OR ref LIKE '${h}' || '%'`).join(" OR ")}
       ) GROUP BY ref ORDER BY views DESC LIMIT 8`,
    ).bind(siteId, sinceDay),
  ]);
  return {
    byVendor: (byVendor.results ?? []) as CrawlRow[],
    topPaths: (topPaths.results ?? []) as Array<{ path: string; n: number }>,
    referrals: (referrals.results ?? []) as Array<{ ref: string; views: number }>,
  };
}

export async function maybePruneCrawls(env: Env, now: number): Promise<void> {
  const last = Number(
    (await getSetting(env.DB, "last_crawl_prune_at")) ?? 0,
  );
  if (now - last < 60 * 60 * 1000) return;
  const cutoff = new Date(now - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  await env.DB.prepare("DELETE FROM crawls WHERE day < ?").bind(cutoff).run();
  await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES ('last_crawl_prune_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  )
    .bind(String(now))
    .run();
}

export const AI_BOTS_PACKAGE = "indiestack-ai-bots";
const DEFAULT_ENDPOINT = "https://indiestack.manol-trendafilov.workers.dev";

export type InstallSnippet = { id: string; label: string; file: string; code: string };
export type InstallGuide = { install: string; snippets: InstallSnippet[]; prompt: string };

/**
 * Install guide for the indiestack-ai-bots npm package: per-stack code plus a
 * prompt for an AI coding agent. Every snippet is complete — never truncated.
 */
export function installGuide(origin: string, token: string, siteName: string): InstallGuide {
  const opts =
    origin.replace(/\/$/, "") === DEFAULT_ENDPOINT
      ? `{ websiteId: "${token}" }`
      : `{ websiteId: "${token}", endpoint: "${origin}" }`;
  const install = `npm install ${AI_BOTS_PACKAGE}`;
  const snippets: InstallSnippet[] = [
    {
      id: "nextjs",
      label: "Next.js",
      file: "middleware.ts (proxy.ts on Next.js 16+)",
      code: `import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { trackAIBotRequest } from "${AI_BOTS_PACKAGE}";

// Next.js 16+: name this file proxy.ts and the function proxy.
export async function middleware(request: NextRequest, event: NextFetchEvent) {
  await trackAIBotRequest(request, event, ${opts});
  return NextResponse.next();
}

// Run on pages, skip Next.js internals and static files.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};`,
    },
    {
      id: "worker",
      label: "Cloudflare Worker",
      file: "src/index.ts (your Worker entry)",
      code: `import { withAIBotTracking } from "${AI_BOTS_PACKAGE}";

const app = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // ...your existing fetch handler, unchanged...
    return new Response("ok");
  },
};

export default {
  fetch: withAIBotTracking((request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx), ${opts}),
};`,
    },
    {
      id: "pages",
      label: "Cloudflare Pages",
      file: "functions/_middleware.ts",
      code: `import { trackAIBotResponse } from "${AI_BOTS_PACKAGE}";

export const onRequest: PagesFunction = async (context) => {
  const response = await context.next();
  await trackAIBotResponse(context.request, response, context, ${opts});
  return response;
};`,
    },
    {
      id: "express",
      label: "Express / Node",
      file: "server.ts (before your routes)",
      code: `import { trackAIBotRequest } from "${AI_BOTS_PACKAGE}";

app.use((req, res, next) => {
  // Express requests are not web Requests: build one with the fields the package reads.
  const request = new Request(\`\${req.protocol}://\${req.get("host")}\${req.originalUrl}\`, {
    headers: { "user-agent": req.get("user-agent") ?? "", "x-real-ip": req.ip ?? "" },
  });
  trackAIBotRequest(request, undefined, ${opts}).catch(() => {});
  next();
});`,
    },
    {
      id: "hono",
      label: "Hono",
      file: "src/index.ts (before your routes)",
      code: `import { trackAIBotResponse } from "${AI_BOTS_PACKAGE}";

app.use("*", async (c, next) => {
  await next();
  let ctx: unknown;
  try {
    ctx = c.executionCtx; // Workers/Bun: lets tracking finish after the response
  } catch {
    ctx = undefined; // Node: no execution context
  }
  await trackAIBotResponse(c.req.raw, c.res, ctx, ${opts});
});`,
    },
  ];

  const prompt = `Install server-side AI-crawler tracking in this project (indiestack site: ${siteName}) using the npm package "${AI_BOTS_PACKAGE}".

AI crawlers (GPTBot, ClaudeBot, PerplexityBot, …) do not run JavaScript, so this must run on the server/edge for incoming page requests — not in the browser. The package filters locally (only known AI bots on document paths are reported), never throws, and uses waitUntil when the runtime provides one.

1. Run: ${install}
2. Find this project's server/edge entry point and wire the package in, keeping all existing logic and exports. Use the site token "${token}"${opts.includes("endpoint") ? ` and endpoint "${origin}"` : ""}.

${snippets.map((s) => `--- ${s.label} — ${s.file}\n${s.code}`).join("\n\n")}

Other stacks (Astro, SvelteKit, Nuxt, Remix, Fastify, …): call trackAIBotRequest(request, contextWithWaitUntilOrUndefined, ${opts}) from the framework's server middleware/request hook, passing a web-standard Request.
Purely static site with no server layer: say so and add the smallest edge layer the host supports (Cloudflare Pages functions/_middleware.ts, Vercel middleware.ts, Netlify edge function) — not client-side JavaScript.

3. Do not change any other behaviour and do not add other dependencies.
4. Verify after deploying:
   curl -s -o /dev/null -A "Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)" https://<your-domain>/
   Then refresh indiestack admin → ai crawlers → ${siteName}: "GPTBot" should be listed.`;

  return { install, snippets, prompt };
}
