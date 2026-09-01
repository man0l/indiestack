import { getSetting } from "./db";

const COOKIE = "indie_admin";

function envToken(env: Env): string | null {
  const v = (env as { ADMIN_TOKEN?: string }).ADMIN_TOKEN?.trim() ?? "";
  if (!v || v === "change-me") return null;
  return v;
}

export async function resolveAdminToken(env: Env): Promise<string | null> {
  return envToken(env) ?? (await getSetting(env.DB, "admin_token"));
}

export async function mintAdminToken(env: Env): Promise<{ token: string; created: boolean }> {
  const generated = generateToken();
  const ins = await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES ('admin_token', ?) ON CONFLICT(key) DO NOTHING",
  )
    .bind(generated)
    .run();
  const created = (ins.meta.changes ?? 0) > 0;
  const token = created ? generated : ((await getSetting(env.DB, "admin_token")) ?? generated);
  return { token, created };
}

function generateToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function isAdmin(request: Request, expected: string): Promise<boolean> {
  const fromCookie = cookieValue(request, COOKIE);
  const auth = request.headers.get("authorization");
  const fromHeader = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7) : null;
  const got = fromCookie ?? fromHeader;
  if (!got) return false;
  return safeEqual(got, expected);
}

function cookieValue(request: Request, name: string): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function setCookie(request: Request, token: string): string {
  const url = new URL(request.url);
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`;
}

export function clearCookie(request: Request): string {
  const url = new URL(request.url);
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const aa = enc.encode(a);
  const bb = enc.encode(b);
  const n = Math.max(aa.byteLength, bb.byteLength, 1);
  const xa = new Uint8Array(n);
  const xb = new Uint8Array(n);
  xa.set(aa);
  xb.set(bb);
  const sameLen = aa.byteLength === bb.byteLength;
  return crypto.subtle.timingSafeEqual(xa, xb) && sameLen;
}
