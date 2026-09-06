/**
 * @indiestack/ai-bots — server-side AI bot tracking.
 *
 * Install in the tracked project's runtime (Next.js proxy, Cloudflare
 * Workers/Pages, Express, Hono — any web-standard handler). The package
 * pre-filters locally (known AI bot user-agents, document paths only) and
 * ships a small event to your indiestack worker, which is the source of
 * truth for provider classification, category, IP verification and the
 * crawler list — so lists update without upgrading this package.
 *
 * Zero dependencies. Non-blocking: uses waitUntil when the runtime offers it.
 */

export type AIBotCategory = "answer_fetch" | "search_index" | "training" | "ai_crawler";

export type AIBotEvent = {
  /** analytics site token (data-site value of the tracked site) */
  websiteId: string;
  /** requested path, e.g. /pricing */
  path: string;
  /** full origin the bot requested, when derivable */
  hostname: string | null;
  /** request user-agent (raw) */
  ua: string;
  /** response status when the adapter could see it, else 0 */
  status: number;
  /** crawler IP — first hop of x-forwarded-for when present */
  crawlerIp: string | null;
  ts: number;
};

export type AIBotOptions = {
  /** analytics site token (data-site value) */
  websiteId: string;
  /** indiestack worker origin; defaults to https://indiestack.manol-trendafilov.workers.dev */
  endpoint?: string;
  /** optional shared secret checked by the worker (x-indiestack-token) */
  authToken?: string;
  /** origin of the tracked site, when the runtime cannot derive it */
  publicOrigin?: string;
  /** local sink instead of the HTTP endpoint (self-hosted / dogfooding) */
  onEvent?: (event: AIBotEvent) => void | Promise<unknown>;
};

type BotSpec = { re: RegExp; agent: string; category: AIBotCategory };

/** Local pre-filter + category hint. The worker re-derives authoritatively. */
const KNOWN_BOTS: BotSpec[] = [
  { re: /gptbot/i, agent: "GPTBot", category: "training" },
  { re: /oai-searchbot/i, agent: "OAI-SearchBot", category: "search_index" },
  { re: /chatgpt-user/i, agent: "ChatGPT-User", category: "answer_fetch" },
  { re: /claudebot|claude-web|anthropic-ai/i, agent: "ClaudeBot", category: "training" },
  { re: /claude-user|claude-searchbot/i, agent: "Claude-User", category: "answer_fetch" },
  { re: /perplexitybot|perplexity-user/i, agent: "PerplexityBot", category: "search_index" },
  { re: /google-extended/i, agent: "Google-Extended", category: "training" },
  { re: /googlebot/i, agent: "Googlebot", category: "search_index" },
  { re: /applebot-extended/i, agent: "Applebot-Extended", category: "training" },
  { re: /applebot/i, agent: "Applebot", category: "training" },
  { re: /bytespider/i, agent: "Bytespider", category: "training" },
  { re: /ccbot/i, agent: "CCBot", category: "training" },
  { re: /amazonbot/i, agent: "Amazonbot", category: "training" },
  { re: /meta-externalagent|facebookagent/i, agent: "meta-externalagent", category: "training" },
  { re: /bingbot/i, agent: "Bingbot", category: "search_index" },
  { re: /duckduckbot/i, agent: "DuckDuckBot", category: "search_index" },
  { re: /grokbot|xai-searchbot/i, agent: "Grok", category: "answer_fetch" },
  { re: /youbot/i, agent: "YouBot", category: "answer_fetch" },
];

const ASSET_RE =
  /\.(css|js|mjs|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|pdf|zip|gz)$/i;
const INTERNAL_RE = /^\/(api|_app|hit|event|beat|log|mcp|favicon\.ico|health)\b/;
/** Crawler-facing documents worth tracking even though they are "files". */
const BOT_DOCS = /\/(robots\.txt|llms\.txt|llms-full\.txt|sitemap\.xml)$/i;

function firstForwardedIp(request: Request): string | null {
  const xff = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip");
  if (!xff) return null;
  const first = xff.split(",")[0]?.trim();
  return first || null;
}

/** Local pre-filter: is this request worth reporting? */
export function matchAIBot(ua: string, path: string): { agent: string; category: AIBotCategory } | null {
  if (!ua) return null;
  const isDoc = !ASSET_RE.test(path) && !INTERNAL_RE.test(path);
  if (!isDoc && !BOT_DOCS.test(path)) return null;
  for (const spec of KNOWN_BOTS) {
    if (spec.re.test(ua)) return { agent: spec.agent, category: spec.category };
  }
  return null;
}

function waitUntilIn(context: unknown): ((p: Promise<unknown>) => void) | null {
  const c = context as { waitUntil?: unknown } | undefined | null;
  // Bind: workerd throws "Illegal invocation" if waitUntil is called unbound.
  return typeof c?.waitUntil === "function"
    ? (p: Promise<unknown>) => (c.waitUntil as (p: Promise<unknown>) => void).call(c, p)
    : null;
}

function originOf(request: Request, opts?: AIBotOptions): string {
  if (opts?.publicOrigin) return opts.publicOrigin;
  try {
    return new URL(request.url).hostname;
  } catch {
    return "";
  }
}

/**
 * Report one request. Fire-and-forget: uses context.waitUntil when provided
 * (Next.js proxy event, Workers ExecutionContext), otherwise runs inline.
 */
export async function trackAIBotRequest(
  request: Request,
  context?: unknown,
  opts?: AIBotOptions,
): Promise<void> {
  if (!opts?.websiteId) return;
  const ua = request.headers.get("user-agent") ?? "";
  let path = "/";
  try {
    path = new URL(request.url).pathname.slice(0, 200);
  } catch {
    /* keep / */
  }
  if (!matchAIBot(ua, path)) return;

  const event: AIBotEvent = {
    websiteId: opts.websiteId,
    path,
    hostname: originOf(request, opts) || null,
    ua: ua.slice(0, 200),
    status: 0,
    crawlerIp: firstForwardedIp(request),
    ts: Date.now(),
  };
  await deliver(event, opts, context);
}

/**
 * Response-aware variant: also records the status code the bot received.
 * Wrap a web-standard handler:
 *
 *   export default {
 *     fetch: (request, env, ctx) =>
 *       withAIBotTracking(myHandler, { websiteId: "...", onEvent: sink })(
 *         request, env, ctx,
 *       ),
 *   };
 */
export function withAIBotTracking<O>(
  handler: (request: Request, ...rest: O[]) => Promise<Response> | Response,
  opts?: AIBotOptions & { onEvent?: (event: AIBotEvent) => void | Promise<unknown> },
): (request: Request, ...rest: O[]) => Promise<Response> {
  return async (request: Request, ...rest: O[]) => {
    const response = await handler(request, ...rest);
    try {
      const context = rest.find(
        (arg) => Boolean(arg) && typeof (arg as { waitUntil?: unknown })?.waitUntil === "function",
      ) as { waitUntil: (p: Promise<unknown>) => void } | undefined;
      await trackAIBotResponse(request, response, context, opts);
    } catch {
      /* tracking must never break the response */
    }
    return response;
  };
}

/** Response-aware tracking when you already have the response. */
export async function trackAIBotResponse(
  request: Request,
  response: Response,
  context?: unknown,
  opts?: AIBotOptions,
): Promise<void> {
  if (!opts?.websiteId) return;
  const ua = request.headers.get("user-agent") ?? "";
  let path = "/";
  try {
    path = new URL(request.url).pathname.slice(0, 200);
  } catch {
    /* keep / */
  }
  if (!matchAIBot(ua, path)) return;

  const event: AIBotEvent = {
    websiteId: opts.websiteId,
    path,
    hostname: originOf(request, opts) || null,
    ua: ua.slice(0, 200),
    status: response.status,
    crawlerIp: firstForwardedIp(request),
    ts: Date.now(),
  };
  await deliver(event, opts, context);
}

async function deliver(event: AIBotEvent, opts: AIBotOptions, context?: unknown): Promise<void> {
  const run = async () => {
    try {
      if (opts.onEvent) {
        await opts.onEvent(event);
        return;
      }
      const endpoint = (opts.endpoint ?? "https://indiestack.manol-trendafilov.workers.dev").replace(/\/$/, "");
      await fetch(`${endpoint}/api/ai-bots`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(opts.authToken ? { "x-indiestack-token": opts.authToken } : {}),
        },
        body: JSON.stringify(event),
      });
    } catch (err) {
      console.error("[ai-bots] delivery failed", String(err));
    }
  };
  const waitUntil = waitUntilIn(context);
  if (waitUntil) waitUntil(run());
  else await run();
}
