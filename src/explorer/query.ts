import {
  hydrateEvents,
  listEvents,
  listLogSources,
  type LogEvent,
  type LogSource,
} from "../logs/index";

export type LogQuery = {
  sourceId: string | null;
  level: string | null;
  q: string;
  limit: number;
};

export type ViewEvent = LogEvent & { source_id: string; source_name: string };

const SCAN = 100;
const SHOW = 100;

export function parseQuery(url: URL, pathSourceId?: string | null): LogQuery {
  const sourceId = pathSourceId || url.searchParams.get("source") || null;
  const level = (url.searchParams.get("level") ?? "").trim().toLowerCase() || null;
  const q = (url.searchParams.get("q") ?? "").trim();
  return { sourceId, level, q, limit: SHOW };
}

export async function queryLogs(
  env: Env,
  q: LogQuery,
): Promise<{ events: ViewEvent[]; sources: LogSource[] }> {
  const sources = await listLogSources(env.DB);
  const names = new Map(sources.map((s) => [s.id, s.name]));
  const selected = q.sourceId ? sources.filter((s) => s.id === q.sourceId) : sources;
  const batches = await Promise.all(selected.map((s) => listEvents(env, s.id, SCAN)));
  let events: ViewEvent[] = batches.flat().map((e) => {
    const source_id = sourceIdFromKey(e.key) ?? q.sourceId ?? "";
    return {
      ...e,
      source_id,
      source_name: names.get(source_id) ?? source_id,
    };
  });
  events.sort((a, b) => b.ts - a.ts);
  if (q.level) {
    events = events.filter((e) => (e.level ?? "log").toLowerCase() === q.level);
  }
  if (q.q) {
    const needle = q.q.toLowerCase();
    events = events.filter((e) => e.message.toLowerCase().includes(needle));
  }
  events = events.slice(0, q.limit);
  const hydrated = await hydrateEvents(env, events);
  return {
    sources,
    events: hydrated.map((e, i) => ({
      ...events[i],
      ...e,
      source_id: events[i].source_id,
      source_name: events[i].source_name,
    })),
  };
}

function sourceIdFromKey(key: string): string | null {
  const m = key.match(/^logs\/([^/]+)\//);
  return m?.[1] ?? null;
}
