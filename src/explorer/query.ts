import { queryEvents, listLogSources, type LogSource } from "../logs/index";
import { getCfMapping } from "../cloudflare/index";
export type LogQuery = {
  sourceId: string | null;
  level: string | null;
  q: string;
  limit: number;
};

export type ViewEvent = {
  key: string;
  ts: number;
  level: string | null;
  message: string;
  data: unknown;
  source_id: string;
  source_name: string;
};

const SHOW = 100;

export function parseQuery(url: URL, pathSourceId?: string | null): LogQuery {
  const sourceId = pathSourceId || url.searchParams.get("source") || null;
  const level = (url.searchParams.get("level") ?? "").trim().toLowerCase() || null;
  const q = (url.searchParams.get("q") ?? "").trim();
  return { sourceId, level, q, limit: SHOW };
}

/** Single indexed D1 query — filters and ordering live in SQL now. */
export async function queryLogs(
  env: Env,
  q: LogQuery,
): Promise<{ events: ViewEvent[]; sources: LogSource[] }> {
  const sources = await listLogSources(env.DB);
  const names = new Map(sources.map((s) => [s.id, s.name]));
  const mapping = await getCfMapping(env);
  const quietSources = [...new Set(Object.values(mapping).filter((p) => p.quiet).map((p) => p.source))];
  const rows = await queryEvents(env, {
    sourceId: q.sourceId,
    level: q.level,
    q: q.q,
    limit: q.limit,
    quietSources,
  });
  return {
    sources,
    events: rows.map((r) => ({
      key: r.key,
      ts: r.ts,
      level: r.level,
      message: r.message,
      data: r.data,
      source_id: r.source_id,
      source_name: names.get(r.source_id) ?? r.source_id,
    })),
  };
}
