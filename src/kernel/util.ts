export function trunc(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

export function ymd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function agoMs(ts: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export async function readCapped(body: ReadableStream<Uint8Array>, cap: number): Promise<string> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let out = "";
  try {
    while (out.length < cap) {
      const { done, value } = await reader.read();
      if (done) break;
      out += dec.decode(value, { stream: true });
      if (out.length >= cap) {
        out = out.slice(0, cap);
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return out;
}

export function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function parseHttpUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u;
  } catch {
    return null;
  }
}

export function parseMuteUntil(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const t = Date.parse(s.endsWith("Z") ? s : `${s}Z`);
  return Number.isFinite(t) ? t : null;
}
