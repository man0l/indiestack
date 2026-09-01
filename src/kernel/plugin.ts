export type RouteCtx = {
  request: Request;
  env: Env;
  url: URL;
  path: string;
  method: string;
  origin: string;
};

export type SectionCtx = {
  env: Env;
  origin: string;
  title: string;
};

export type Health = {
  up: number;
  down: number;
  unknown: number;
  last?: number | null;
};

export type TickStats = Record<string, number>;

export type Plugin = {
  id: string;
  route?(ctx: RouteCtx): Promise<Response | null> | Response | null;
  admin?(ctx: RouteCtx): Promise<Response | null> | Response | null;
  adminSection?(ctx: SectionCtx): Promise<string> | string;
  adminFooter?: string;
  summary?(ctx: SectionCtx): Promise<string> | string;
  statusSection?(ctx: SectionCtx): Promise<string> | string;
  statusTail?(ctx: SectionCtx): Promise<string> | string;
  statusKicker?(ctx: SectionCtx): Promise<string | null> | string | null;
  occupied?(ctx: SectionCtx): Promise<boolean> | boolean;
  health?(env: Env, now: number): Promise<Health>;
  tick?(env: Env, now: number, webhook: string | null): Promise<TickStats>;
};

export async function dispatch(
  plugins: Plugin[],
  key: "route" | "admin",
  ctx: RouteCtx,
): Promise<Response | null> {
  for (const p of plugins) {
    const fn = p[key];
    if (!fn) continue;
    const res = await fn(ctx);
    if (res) return res;
  }
  return null;
}

export async function collect(
  plugins: Plugin[],
  key: "adminSection" | "statusSection" | "statusTail" | "summary",
  ctx: SectionCtx,
): Promise<string[]> {
  const out: string[] = [];
  for (const p of plugins) {
    const fn = p[key];
    if (!fn) continue;
    const s = await fn(ctx);
    if (s) out.push(s);
  }
  return out;
}

export async function firstKicker(plugins: Plugin[], ctx: SectionCtx): Promise<string | null> {
  for (const p of plugins) {
    if (!p.statusKicker) continue;
    const s = await p.statusKicker(ctx);
    if (s) return s;
  }
  return null;
}

export async function sumHealth(plugins: Plugin[], env: Env, now: number): Promise<Health> {
  const acc: Health = { up: 0, down: 0, unknown: 0, last: null };
  for (const p of plugins) {
    if (!p.health) continue;
    const h = await p.health(env, now);
    acc.up += h.up;
    acc.down += h.down;
    acc.unknown += h.unknown;
    if (h.last != null) acc.last = Math.max(acc.last ?? 0, h.last);
  }
  return acc;
}

export async function runPluginTicks(
  plugins: Plugin[],
  env: Env,
  now: number,
  webhook: string | null,
): Promise<TickStats> {
  const acc: TickStats = { alerts: 0 };
  for (const p of plugins) {
    if (!p.tick) continue;
    const stats = await p.tick(env, now, webhook);
    for (const [k, v] of Object.entries(stats)) {
      acc[k] = (acc[k] ?? 0) + v;
    }
  }
  return acc;
}
