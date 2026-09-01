export const MAX_MONITORS = 20;
export const MAX_JOBS = 20;

export type Kind = "http" | "tcp" | "udp" | "icmp" | "dns" | "ssl" | "domain";

export type Monitor = {
  id: string;
  name: string;
  url: string;
  interval_min: number;
  expect_status: number;
  timeout_ms: number;
  keyword: string | null;
  keyword_mode: string | null;
  max_latency_ms: number | null;
  enabled: number;
  status: "up" | "down" | "unknown";
  last_check_at: number | null;
  last_status_code: number | null;
  last_latency_ms: number | null;
  last_error: string | null;
  consecutive: number;
  created_at: number;
  mute_until: number | null;
  headers: string | null;
  nag_min: number;
  last_nag_at: number | null;
};

export type Job = {
  id: string;
  name: string;
  token: string;
  interval_min: number;
  grace_min: number;
  enabled: number;
  status: "up" | "down" | "unknown";
  last_beat_at: number | null;
  last_error: string | null;
  consecutive: number;
  created_at: number;
  mute_until: number | null;
  nag_min: number;
  last_nag_at: number | null;
};

export type Incident = {
  ts: number;
  name: string;
  url: string;
  error: string | null;
};

export function isMuted(
  enabled: number,
  mute_until: number | null | undefined,
  now = Date.now(),
): boolean {
  if (!enabled) return true;
  return mute_until != null && mute_until > now;
}
