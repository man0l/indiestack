import { buildTarget, type Kind } from "./tick";

export type Template = {
  id: string;
  label: string;
  kind: Kind;
  interval_min: number;
  timeout_ms: number;
  target: (host: string) => string;
  name: (host: string) => string;
};

export const TEMPLATES: Template[] = [
  {
    id: "https",
    label: "HTTPS",
    kind: "http",
    interval_min: 5,
    timeout_ms: 8000,
    target: (h) => `https://${h}/`,
    name: (h) => h,
  },
  {
    id: "http",
    label: "HTTP",
    kind: "http",
    interval_min: 5,
    timeout_ms: 8000,
    target: (h) => `http://${h}/`,
    name: (h) => `${h} http`,
  },
  {
    id: "tcp443",
    label: "TCP 443",
    kind: "tcp",
    interval_min: 5,
    timeout_ms: 8000,
    target: (h) => `${h}:443`,
    name: (h) => `${h}:443`,
  },
  {
    id: "ssh",
    label: "SSH 22",
    kind: "tcp",
    interval_min: 5,
    timeout_ms: 8000,
    target: (h) => `${h}:22`,
    name: (h) => `${h} ssh`,
  },
  {
    id: "postgres",
    label: "Postgres 5432",
    kind: "tcp",
    interval_min: 5,
    timeout_ms: 8000,
    target: (h) => `${h}:5432`,
    name: (h) => `${h} postgres`,
  },
  {
    id: "mysql",
    label: "MySQL 3306",
    kind: "tcp",
    interval_min: 5,
    timeout_ms: 8000,
    target: (h) => `${h}:3306`,
    name: (h) => `${h} mysql`,
  },
  {
    id: "redis",
    label: "Redis 6379",
    kind: "tcp",
    interval_min: 5,
    timeout_ms: 8000,
    target: (h) => `${h}:6379`,
    name: (h) => `${h} redis`,
  },
  {
    id: "smtp",
    label: "Mail 587",
    kind: "tcp",
    interval_min: 5,
    timeout_ms: 8000,
    target: (h) => `${h}:587`,
    name: (h) => `${h} smtp`,
  },
  {
    id: "host",
    label: "Host up",
    kind: "icmp",
    interval_min: 5,
    timeout_ms: 8000,
    target: (h) => h,
    name: (h) => `${h} host`,
  },
  {
    id: "dns-a",
    label: "DNS A",
    kind: "dns",
    interval_min: 5,
    timeout_ms: 8000,
    target: (h) => `${h}/A`,
    name: (h) => `${h} dns a`,
  },
  {
    id: "dns-aaaa",
    label: "DNS AAAA",
    kind: "dns",
    interval_min: 5,
    timeout_ms: 8000,
    target: (h) => `${h}/AAAA`,
    name: (h) => `${h} dns aaaa`,
  },
  {
    id: "dns-mx",
    label: "DNS MX",
    kind: "dns",
    interval_min: 5,
    timeout_ms: 8000,
    target: (h) => `${h}/MX`,
    name: (h) => `${h} dns mx`,
  },
  {
    id: "ssl",
    label: "SSL expiry",
    kind: "ssl",
    interval_min: 60,
    timeout_ms: 12000,
    target: (h) => h,
    name: (h) => `${h} ssl`,
  },
  {
    id: "domain",
    label: "Domain expiry",
    kind: "domain",
    interval_min: 60,
    timeout_ms: 12000,
    target: (h) => h,
    name: (h) => `${h} domain`,
  },
];

export function normalizeHost(raw: string): string | null {
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^https?:\/\//, "");
  s = s.split("/")[0] ?? s;
  s = s.split("@").pop() ?? s;
  s = s.replace(/:\d+$/, "");
  s = s.replace(/\.$/, "");
  if (!s || s.includes(" ") || s.includes("://")) return null;
  return s;
}

export function applyTemplate(
  id: string,
  hostRaw: string,
): { kind: Kind; url: string; name: string; interval_min: number; timeout_ms: number } | null {
  const host = normalizeHost(hostRaw);
  if (!host) return null;
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) return null;
  const url = buildTarget(t.kind, t.target(host));
  if (!url) return null;
  return {
    kind: t.kind,
    url,
    name: t.name(host).slice(0, 40),
    interval_min: t.interval_min,
    timeout_ms: t.timeout_ms,
  };
}
