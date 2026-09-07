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
  /** Authoritative ASN when the runtime provides it (Cloudflare cf.asn). */
  asn?: number;
};

export type AIBotCategory = "answer_fetch" | "search_index" | "training" | "ai_crawler";

/**
 * Vendors without published JSON ranges verify via their autonomous system.
 * Add ASNs here as they are confirmed — never guess.
 */
const VENDOR_ASNS: Record<string, number[]> = {
  meta: [32934], // Facebook/Meta — includes meta-externalagent
  google: [15169], // Google LLC — Googlebot, Google-Extended
};

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

const RANGES_KEY = "crawler_ranges_v3"; // bump to bust cached ranges when sources change
const RANGES_TTL = 86400;
const RANGES_TTL_FAILURE = 300;
// Vendors with machine-readable {prefixes: [...]} lists. Others: UA-only until
// endpoints are confirmed.
const RANGE_SOURCES: Array<{ vendor: string; url: string }> = [
  { vendor: "openai", url: "https://openai.com/gptbot.json" },
  { vendor: "anthropic", url: "https://claude.com/crawling/bots.json" },
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

/** Flatten vendor range lists — OpenAI ships {prefixes:[{ipv4Prefix|ipv6Prefix}]}. */
function normalizePrefixes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const p of raw) {
    if (typeof p === "string") out.push(p);
    else if (p && typeof p === "object") {
      const o = p as Record<string, unknown>;
      if (typeof o.ipv4Prefix === "string") out.push(o.ipv4Prefix);
      if (typeof o.ipv6Prefix === "string") out.push(o.ipv6Prefix);
    }
  }
  return out;
}

async function cachedRanges(env: Env): Promise<RangeCache> {
  try {
    const hit = await env.CACHE.get<RangeCache>(RANGES_KEY, "json");
    // An all-empty result means the last fetch failed — retry instead of trusting it.
    if (hit?.ranges && Object.values(hit.ranges).some((r) => r.length)) return hit;
  } catch {
    /* fall through to fetch */
  }
  const ranges: Record<string, string[]> = {};
  await Promise.all(
    RANGE_SOURCES.map(async ({ vendor, url }) => {
      try {
        const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5000) });
        if (!res.ok) return;
        const json = (await res.json()) as unknown;
        const prefixes =
          typeof json === "object" && json !== null && "prefixes" in json
            ? normalizePrefixes((json as { prefixes?: unknown }).prefixes)
            : [];
        if (prefixes.length) ranges[vendor] = prefixes;
      } catch {
        /* vendor ranges unavailable — UA-only */
      }
    }),
  );
  const cache: RangeCache = { fetched_at: Date.now(), ranges };
  const any = Object.values(ranges).some((r) => r.length);
  await env.CACHE.put(RANGES_KEY, JSON.stringify(cache), { expirationTtl: any ? RANGES_TTL : RANGES_TTL_FAILURE }).catch(() => {});
  return cache;
}

// ------------------------------------------------------------ IP → ASN

/** Team Cymru IP-to-ASN via Cloudflare DoH (JSON), cached 7 days per IP. */
async function ipToAsn(env: Env, ip: string): Promise<number[]> {
  const key = `asn:${ip}`;
  try {
    const hit = await env.CACHE.get<number[]>(key, "json");
    if (Array.isArray(hit)) return hit;
  } catch {
    /* fall through to lookup */
  }
  const asns: number[] = [];
  try {
    const name = ip.includes(":")
      ? `${(expandV6(ip) ?? []).reverse().join(".")}.origin6.asn.cymru.com`
      : `${ip.split(".").reverse().join(".")}.origin.asn.cymru.com`;
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${name}&type=TXT`, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const json = (await res.json()) as { Answer?: Array<{ data?: string }> };
      for (const a of json.Answer ?? []) {
        // Cymru TXT: "32934 | 173.252.96.0/19 | US | arin | …" (AS prefix optional)
        const m = String(a.data ?? "").match(/(?:AS)?(\d+)\s*\|/);
        if (m) asns.push(Number(m[1]));
      }
    }
  } catch {
    /* lookup is best-effort */
  }
  // Cache successes 7d; an empty result (transient DoH failure) retries in 5 min
  // instead of poisoning the IP for a week.
  await env.CACHE.put(key, JSON.stringify(asns), { expirationTtl: asns.length ? 604800 : 300 }).catch(() => {});
  return asns;
}

/** Expand an IPv6 address (incl. :: and v4 addresses) into 32 nibbles. */
function expandV6(ip: string): string[] | null {
  let addr = ip.split("/")[0].toLowerCase();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(addr)) {
    const q = addr.split(".").map(Number);
    addr = `::ffff:${((q[0] << 8) | q[1]).toString(16)}:${((q[2] << 8) | q[3]).toString(16)}`;
  }
  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":").filter(Boolean) : [];
  const tail = halves.length === 2 ? halves[1].split(":").filter(Boolean) : [];
  const fill = 8 - head.length - tail.length;
  if (fill < 0 || (halves.length === 1 && fill !== 0)) return null;
  const groups = [...head, ...Array(fill).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  return groups.flatMap((g) => g.padStart(4, "0").split(""));
}

// ------------------------------------------------------------ ingest

const CRAWLER_CAP_PER_DAY = 500;

/**
 * Ingest one AI-bot event from the SDK. The site token must be a known,
 * enabled analytics site (the ingest endpoint is public like /hit, so the
 * token is the gate). Capped per site/day to protect write quota.
 *
 * Resolution order: UA self-declaration names the agent; published IP ranges
 * are authoritative — a UA-claimed bot is only "verified" when its IP falls
 * in its own vendor's ranges, and a faked/unknown UA is still recorded when
 * the IP matches a known crawler range.
 */
export async function ingestAIBotEvent(env: Env, event: AIBotEventIn): Promise<boolean> {
  if (!event?.websiteId || !event.path) return false;
  const site = await env.DB.prepare("SELECT id FROM analytics_sites WHERE token = ? AND enabled = 1")
    .bind(event.websiteId)
    .first<{ id: string }>();
  if (!site) return false;
  const day = new Date(event.ts || Date.now()).toISOString().slice(0, 10);
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM crawler_fetches WHERE site_id = ? AND day = ?")
    .bind(site.id, day)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= CRAWLER_CAP_PER_DAY) return false;

  const claimed = matchAIBotServer(event.ua);
  let resolved: { agent: string; vendor: string; category: AIBotCategory } | null = claimed
    ? { ...claimed }
    : null;
  let verified = false;
  if (event.crawlerIp) {
    try {
      const { ranges } = await cachedRanges(env);
      for (const [vendor, list] of Object.entries(ranges)) {
        if (!ipInRanges(event.crawlerIp, list)) continue;
        if (claimed) {
          // UA-claimed bots are only verified by their own vendor's ranges.
          if (vendor === claimed.vendor) verified = true;
        } else {
          // No UA claim, but the IP is in a known crawler range: cloaked bot.
          const repr = AI_BOTS.find((b) => b.vendor === vendor);
          resolved = { agent: repr?.agent ?? vendor, vendor, category: "ai_crawler" };
          verified = true;
        }
        break;
      }
    } catch {
      /* verification is best-effort */
    }
  }
  // ASN layer: covers vendors that publish no ranges (Meta → AS32934,
  // Google → AS15169). Uses the runtime-provided ASN when present
  // (Cloudflare self-track), else Team Cymru via DoH — cached 7d per IP.
  if (!verified && (event.crawlerIp || event.asn)) {
    try {
      const asns = event.asn ? [event.asn] : await ipToAsn(env, event.crawlerIp!);
      const asnVendor = Object.entries(VENDOR_ASNS).find(([, list]) =>
        asns.some((a) => list.includes(a)),
      );
      if (asnVendor) {
        const [vendor] = asnVendor;
        if (claimed) {
          if (vendor === claimed.vendor) verified = true;
        } else {
          const repr = AI_BOTS.find((b) => b.vendor === vendor);
          resolved = { agent: repr?.agent ?? vendor, vendor, category: "ai_crawler" };
          verified = true;
        }
      }
    } catch {
      /* ASN lookup is best-effort */
    }
  }
  if (!resolved) return false;
  await env.DB.prepare(
    `INSERT INTO crawler_fetches (day, ts, path, crawler, vendor, verified, ua, site_id, category, status_code, hostname)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      day,
      event.ts || Date.now(),
      trunc(event.path, 200),
      resolved.agent,
      resolved.vendor,
      verified ? 1 : 0,
      trunc(event.ua, 200),
      site.id,
      resolved.category,
      Math.min(999, Math.max(0, Number(event.status) || 0)),
      event.hostname ? trunc(event.hostname, 200) : null,
    )
    .run();
  return true;
}
