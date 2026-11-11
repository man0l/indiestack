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
  const [byVendor, topPaths, referrals] = await env.DB.batch([
    env.DB.prepare(
      `SELECT vendor, COUNT(*) AS n, MAX(ts) AS last_ts
       FROM crawls WHERE site_id = ? AND day >= ? GROUP BY vendor ORDER BY n DESC`,
    ).bind(siteId, sinceDay),
    env.DB.prepare(
      `SELECT path, COUNT(*) AS n FROM crawls WHERE site_id = ? AND day >= ?
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

/** Cheap UA prefilter for the middleware so only bot-ish requests are forwarded. */
const BOT_UA_SOURCE = [...VENDORS.map(([re]) => re.source), "bot", "crawl", "spider", "slurp"].join("|");

/** Complete, runnable Cloudflare Worker middleware — never truncated, it is meant to be pasted. */
export function ingestSnippet(origin: string, token: string): string {
  return `// indiestack AI-crawler tracking — paste into your Worker's entry file.
const INDIESTACK_CRAWLERS = "${origin}/crawlers/${token}";
const BOT_UA = /${BOT_UA_SOURCE}/i;

// Fire and forget: never delays or breaks your response.
function trackCrawler(request, ctx) {
  const ua = request.headers.get("user-agent") || "";
  if (!BOT_UA.test(ua)) return;
  ctx.waitUntil(
    fetch(INDIESTACK_CRAWLERS, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ua, p: new URL(request.url).pathname }),
    }).catch(() => {}),
  );
}

// Then call it as the first line of your existing fetch handler:
// export default {
//   async fetch(request, env, ctx) {
//     trackCrawler(request, ctx);
//     ...your existing code, unchanged...
//   },
// };`;
}

/** Copy-pastable instruction for an AI coding agent working in the site's repo (any stack). */
export function agentInstructions(origin: string, token: string, siteName: string): string {
  const endpoint = `${origin}/crawlers/${token}`;
  return `Add server-side AI-crawler tracking to this project (site: ${siteName}). AI crawlers (GPTBot, ClaudeBot, PerplexityBot, …) do not run JavaScript, so this must run on the server/edge for every incoming page request, not in the browser.

Requirement: for each incoming HTTP request whose User-Agent matches this regex (case-insensitive)
  /${BOT_UA_SOURCE}/i
send, without awaiting it and without ever failing or delaying the response:
  POST ${endpoint}
  Content-Type: application/json
  Body: {"ua": "<full User-Agent header>", "p": "<request path only, no query string, starting with />"}
Swallow every error from this call. Requests whose User-Agent does not match must not be sent. The endpoint always answers 204.

Pick the hook that matches this project's stack, and edit the existing entry point instead of replacing it:
- Cloudflare Worker: in the module's fetch(request, env, ctx) handler, call ctx.waitUntil(fetch(...).catch(() => {})) as the first statement.
- Cloudflare Pages: add or extend functions/_middleware.(js|ts) with onRequest(context) that calls context.waitUntil(fetch(...).catch(() => {})) and then returns context.next().
- Next.js (Vercel or self-hosted): add or extend middleware.(ts|js) at the project root (or src/) with export function middleware(request, event) that calls event.waitUntil(fetch(...).catch(() => {})) and returns NextResponse.next(); keep any existing matcher and logic, and make sure the matcher includes page routes.
- Astro / SvelteKit / Nuxt / Remix / other SSR frameworks: use the framework's server middleware or request hook and the platform's waitUntil if one exists; otherwise call fetch(...).catch(() => {}) without await.
- Express / Fastify / Koa / other Node servers: register a middleware before the routes that calls fetch(...).catch(() => {}) without await and then next().
- Purely static site with no server layer: say so, and add the smallest edge layer the host supports (e.g. Cloudflare Pages functions/_middleware.js, Vercel middleware.ts, Netlify edge function) rather than client-side JavaScript.

Do not change any other behaviour, do not add dependencies, keep the endpoint URL exactly as written above, and do not log the User-Agent anywhere else.

Verify after deploying:
  curl -s -o /dev/null -A "GPTBot/1.0" https://<your-domain>/
The indiestack admin → ai crawlers → ${siteName} card should list "openai-gptbot" after a refresh. To check the endpoint alone (records one test hit):
  curl -i -X POST "${endpoint}" -H "content-type: application/json" -d '{"ua":"GPTBot/1.0","p":"/indiestack-test"}'`;
}
