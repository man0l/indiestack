import { trunc } from "../kernel/util";

/**
 * Server-side AI bot classification and ingest. The @indiestack/ai-bots SDK
 * pre-filters in the tracked project and ships a small event here; this
 * module is the source of truth for agent naming, category, and IP
 * verification against vendor-published ranges — so bot lists update
 * without SDK upgrades.
 */

export type AIBotEventIn = {
  websiteId: string;
  path: string;
  hostname: string | null;
  ua: string;
  status: number;
  crawlerIp: string | null;
  ts: number;
};

export type AIBotCategory = "answer_fetch" | "search_index" | "training" | "ai_crawler";

const AI_BOTS: Array<{ re: RegExp; agent: string; vendor: string; category: AIBotCategory }> = [
  { re: /gptbot/i, agent: "GPTBot", vendor: "openai", category: "training" },
  { re: /oai-searchbot/i, agent: "OAI-SearchBot", vendor: "openai", category: "search_index" },
  { re: /chatgpt-user/i, agent: "ChatGPT-User", vendor: "openai", category: "answer_fetch" },
  { re: /claudebot|claude-web|anthropic-ai/i, agent: "ClaudeBot", vendor: "anthropic", category: "training" },
  { re: /claude-user|claude-searchbot/i, agent: "Claude-User", vendor: "anthropic", category: "answer_fetch" },
  { re: /perplexitybot|perplexity-user/i, agent: "PerplexityBot", vendor: "perplexity", category: "search_index" },
  { re: /google-extended/i, agent: "Google-Extended", vendor: "google", category: "training" },
  { re: /googlebot/i, agent: "Googlebot", vendor: "google", category: "search_index" },
  { re: /applebot-extended/i, agent: "Applebot-Extended", vendor: "apple", category: "training" },
  { re: /applebot/i, agent: "Applebot", vendor: "apple", category: "training" },
  { re: /bytespider/i, agent: "Bytespider", vendor: "bytedance", category: "training" },
  { re: /ccbot/i, agent: "CCBot", vendor: "common-crawl", category: "training" },
  { re: /amazonbot/i, agent: "Amazonbot", vendor: "amazon", category: "training" },
  { re: /meta-externalagent|facebookagent/i, agent: "meta-externalagent", vendor: "meta", category: "training" },
  { re: /bingbot/i, agent: "Bingbot", vendor: "microsoft", category: "search_index" },
  { re: /duckduckbot/i, agent: "DuckDuckBot", vendor: "duckduckgo", category: "search_index" },
  { re: /grokbot|xai-searchbot/i, agent: "Grok", vendor: "xai", category: "answer_fetch" },
  { re: /youbot/i, agent: "YouBot", vendor: "you", category: "answer_fetch" },
];

function matchAIBotServer(ua: string): { agent: string; vendor: string; category: AIBotCategory } | null {
  for (const b of AI_BOTS) {
    if (b.re.test(ua)) return { agent: b.agent, vendor: b.vendor, category: b.category };
  }
  return null;
}

// ------------------------------------------------------------ IP ranges

const RANGES_KEY = "crawler_ranges";
const RANGES_TTL = 86400;
// Vendors with machine-readable {prefixes: [...]} lists. Others: UA-only until
// endpoints are confirmed.
const RANGE_SOURCES: Array<{ vendor: string; url: string }> = [
  { vendor: "openai", url: "https://openai.com/gptbot.json" },
];

type RangeCache = { fetched_at: number; ranges: Record<string, string[]> };

function ip4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    const v = Number(part);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

function inCidr(ip: string, cidr: string): boolean {
  const [range, bitsRaw] = cidr.split("/");
  const bits = Number(bitsRaw);
  if (ip.includes(":") || range.includes(":")) return false; // v6: exact match only
  const ipN = ip4ToInt(ip);
  const rangeN = ip4ToInt(range);
  if (ipN === null || rangeN === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipN & mask) === (rangeN & mask);
}

function ipInRanges(ip: string, ranges: string[]): boolean {
  for (const cidr of ranges) {
    if (inCidr(ip, cidr)) return true;
    if (ip.includes(":") && cidr.includes(":") && ip.toLowerCase() === cidr.toLowerCase()) return true;
  }
  return false;
}

async function cachedRanges(env: Env): Promise<RangeCache> {
  try {
    const hit = await env.CACHE.get<RangeCache>(RANGES_KEY, "json");
    if (hit?.ranges) return hit;
  } catch {
    /* fall through to fetch */
  }
  const ranges: Record<string, string[]> = {};
  await Promise.all(
    RANGE_SOURCES.map(async ({ vendor, url }) => {
      try {
        const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5000) });
        if (!res.ok) return;
        const json = (await res.json()) as { prefixes?: unknown };
        if (Array.isArray(json.prefixes)) {
          ranges[vendor] = json.prefixes.filter((p): p is string => typeof p === "string");
        }
      } catch {
        /* vendor ranges unavailable — UA-only */
      }
    }),
  );
  const cache: RangeCache = { fetched_at: Date.now(), ranges };
  await env.CACHE.put(RANGES_KEY, JSON.stringify(cache), { expirationTtl: RANGES_TTL }).catch(() => {});
  return cache;
}

// ------------------------------------------------------------ ingest

const CRAWLER_CAP_PER_DAY = 500;

/**
 * Ingest one AI-bot event from the SDK. The site token must be a known,
 * enabled analytics site (the ingest endpoint is public like /hit, so the
 * token is the gate). Capped per site/day to protect write quota.
 */
export async function ingestAIBotEvent(env: Env, event: AIBotEventIn): Promise<boolean> {
  if (!event?.websiteId || !event.ua || !event.path) return false;
  const bot = matchAIBotServer(event.ua);
  if (!bot) return false;
  const site = await env.DB.prepare("SELECT id FROM analytics_sites WHERE token = ? AND enabled = 1")
    .bind(event.websiteId)
    .first<{ id: string }>();
  if (!site) return false;
  const day = new Date(event.ts || Date.now()).toISOString().slice(0, 10);
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM crawler_fetches WHERE site_id = ? AND day = ?")
    .bind(site.id, day)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= CRAWLER_CAP_PER_DAY) return false;
  let verified = false;
  if (event.crawlerIp) {
    try {
      const { ranges } = await cachedRanges(env);
      const vendorRanges = ranges[bot.vendor];
      verified = Boolean(vendorRanges?.length && ipInRanges(event.crawlerIp, vendorRanges));
    } catch {
      /* verification is best-effort */
    }
  }
  await env.DB.prepare(
    `INSERT INTO crawler_fetches (day, ts, path, crawler, vendor, verified, ua, site_id, category, status_code, hostname)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      day,
      event.ts || Date.now(),
      trunc(event.path, 200),
      bot.agent,
      bot.vendor,
      verified ? 1 : 0,
      trunc(event.ua, 200),
      site.id,
      bot.category,
      Math.min(999, Math.max(0, Number(event.status) || 0)),
      event.hostname ? trunc(event.hostname, 200) : null,
    )
    .run();
  return true;
}
