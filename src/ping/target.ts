import type { Kind } from "../kernel/types";

export function kindOf(url: string): Kind {
  if (url.startsWith("tcp:")) return "tcp";
  if (url.startsWith("udp:")) return "udp";
  if (url.startsWith("icmp:")) return "icmp";
  if (url.startsWith("dns:")) return "dns";
  if (url.startsWith("ssl:")) return "ssl";
  if (url.startsWith("domain:")) return "domain";
  return "http";
}

export function buildTarget(kind: string, raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (kind === "http") {
    try {
      const u = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      return u.toString();
    } catch {
      return null;
    }
  }
  if (kind === "icmp" || kind === "ssl" || kind === "domain") {
    const host = trimmed
      .replace(/^(icmp|ssl|domain):\/\//i, "")
      .replace(/\/$/, "")
      .split("/")[0];
    if (!host || host.includes("://") || host.includes(" ")) return null;
    return `${kind}://${host}`;
  }
  if (kind === "dns") {
    const body = trimmed.replace(/^dns:\/\//i, "");
    const [hostPart, typePart] = body.split("/");
    const host = hostPart?.trim();
    const type = (typePart ?? "A").trim().toUpperCase() || "A";
    if (!host || !/^[A-Z0-9]+$/.test(type)) return null;
    return `dns://${host}/${type}`;
  }
  const hp = parseHostPort(trimmed.replace(/^(tcp|udp):\/\//i, ""));
  if (!hp) return null;
  if (hp.port === 25) return null;
  if (kind === "udp") return `udp://${hp.hostname}:${hp.port}`;
  return `tcp://${hp.hostname}:${hp.port}`;
}

export function parseHostPort(raw: string): { hostname: string; port: number } | null {
  const v6 = raw.match(/^\[([^\]]+)\]:(\d+)$/);
  const v4 = raw.match(/^([^:/]+):(\d+)$/);
  const m = v6 ?? v4;
  if (!m) return null;
  const port = Number(m[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { hostname: m[1], port };
}
