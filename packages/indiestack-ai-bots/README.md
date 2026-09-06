# indiestack-ai-bots

Server-side AI bot tracking for [indiestack](https://indiestack.manol-trendafilov.workers.dev) analytics. Detect when AI assistants, AI search systems and training crawlers request pages on your site — from **Next.js proxy, Cloudflare Workers/Pages, Express, Hono**, or any web-standard handler.

Zero dependencies. Non-blocking (uses `waitUntil` when the runtime offers it).

## Install

```bash
npm install indiestack-ai-bots
```

## Usage

### Next.js (proxy.ts / middleware)

```ts
import { trackAIBotRequest, type NextRequestWithWaitUntil } from "indiestack-ai-bots";

export async function proxy(request: NextRequestWithWaitUntil) {
  await trackAIBotRequest(request, request, {
    websiteId: process.env.INDIESTACK_SITE_ID!,
  });
  return NextResponse.next();
}
```

### Cloudflare Workers / Pages

```ts
import { withAIBotTracking } from "indiestack-ai-bots";

export default {
  fetch: withAIBotTracking(myHandler, { websiteId: "your-site-token" }),
};
```

### Hono / Express / anything else

```ts
import { trackAIBotRequest } from "indiestack-ai-bots";

app.use(async (req, res, next) => {
  await trackAIBotRequest(req as unknown as Request, undefined, { websiteId: "your-site-token" });
  next();
});
```

## How it works

1. The package **pre-filters locally**: only requests whose user-agent matches a known AI bot (GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot, Bytespider, Google-Extended, …) on document paths (`robots.txt`, `llms.txt`, `sitemap.xml` included) produce an event. Human traffic and static assets never leave your server.
2. A small event (path, hostname, user-agent, status code, crawler IP) is shipped to your indiestack worker — **the worker is the source of truth** for provider classification, category (`answer_fetch` / `search_index` / `training` / `ai_crawler`), and IP verification against vendor-published ranges. Bot lists update server-side; no SDK upgrades needed.
3. The visitor-facing analytics never see this traffic — it lives in its own crawler log.

## Options

| Option | Type | Description |
|---|---|---|
| `websiteId` | `string` | Required. Your analytics site token (`data-site` value). |
| `endpoint` | `string` | Override the indiestack worker origin (self-hosting). |
| `authToken` | `string` | Optional secret, sent as `x-indiestack-token`. |
| `publicOrigin` | `string` | Tracked site origin when the runtime can't derive it. |
| `onEvent` | `function` | Local sink instead of HTTP delivery — useful for self-tracking inside the indiestack worker itself. |

## Categories

| Category | Meaning | Example agents |
|---|---|---|
| `answer_fetch` | Fetching a page to answer a user right now | ChatGPT-User, Claude-User, Perplexity-User |
| `search_index` | Indexing for AI search results | OAI-SearchBot, PerplexityBot, Googlebot |
| `training` | Collecting data for model training | GPTBot, ClaudeBot, Bytespider, CCBot |
| `ai_crawler` | Other/uncategorized AI fetches | — |
