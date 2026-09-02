import { getSetting } from "../kernel/db";
import { trunc } from "../kernel/util";

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
  const byVendor = await env.DB.prepare(
    `SELECT vendor, COUNT(*) AS n, MAX(ts) AS last_ts
     FROM crawls WHERE site_id = ? AND day >= ? GROUP BY vendor ORDER BY n DESC`,
  )
    .bind(siteId, sinceDay)
    .all<CrawlRow>();
  const topPaths = await env.DB.prepare(
    `SELECT path, COUNT(*) AS n FROM crawls WHERE site_id = ? AND day >= ?
     GROUP BY path ORDER BY n DESC LIMIT 8`,
  )
    .bind(siteId, sinceDay)
    .all<{ path: string; n: number }>();
  // AI referrals come from the analytics base: hits whose referrer is an AI product.
  const referrals = await env.DB.prepare(
    `SELECT ref, COUNT(*) AS views FROM hits
     WHERE site_id = ? AND day >= ? AND ref IS NOT NULL AND (
       ${AI_REFERRERS.map((h) => `ref = '${h}' OR ref LIKE '${h}' || '%'`).join(" OR ")}
     ) GROUP BY ref ORDER BY views DESC LIMIT 8`,
  )
    .bind(siteId, sinceDay)
    .all<{ ref: string; views: number }>();
  return {
    byVendor: byVendor.results ?? [],
    topPaths: topPaths.results ?? [],
    referrals: referrals.results ?? [],
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

export function ingestSnippet(origin: string, token: string): string {
  return trunc(
    `// in your own Worker's fetch handler — fire and forget:
// ctx.waitUntil(fetch("${origin}/crawlers/${token}", {
//   method: "POST",
//   headers: { "content-type": "application/json" },
//   body: JSON.stringify({ ua: request.headers.get("user-agent"), p: new URL(request.url).pathname }),
// }).catch(() => {}));`,
    600,
  );
}
