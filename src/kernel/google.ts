// Google sign-in for /admin (OpenID Connect, authorization-code flow).
//
// Config (Worker secrets / vars):
//   GOOGLE_OAUTH_JSON    the "client_secret_….json" downloaded from Google Cloud
//                        (OAuth client ID, type "Web application"), pasted as-is
//   — or —
//   GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET
//   ADMIN_EMAILS         comma-separated Google accounts allowed in (required)
//
// The id_token comes straight from Google's token endpoint over TLS in exchange
// for our client secret, so per OIDC Core §3.1.3.7 we validate its claims
// (iss, aud, exp, nonce, email_verified) without fetching JWKS.

import { mintAdminToken, resolveAdminToken, safeEqual, setCookie } from "./auth";

const STATE_COOKIE = "indie_g_state";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALLBACK = "/auth/google/callback";

type GoogleEnv = {
  GOOGLE_OAUTH_JSON?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  ADMIN_EMAILS?: string;
};

export type GoogleConfig = { clientId: string; clientSecret: string; allowed: string[] };

export function googleConfig(env: Env): GoogleConfig | null {
  const e = env as unknown as GoogleEnv;
  let clientId = e.GOOGLE_CLIENT_ID?.trim() ?? "";
  let clientSecret = e.GOOGLE_CLIENT_SECRET?.trim() ?? "";
  const raw = e.GOOGLE_OAUTH_JSON?.trim();
  if (raw && (!clientId || !clientSecret)) {
    try {
      const j = JSON.parse(raw) as Record<string, { client_id?: string; client_secret?: string }>;
      const c = j.web ?? j.installed ?? (j as { client_id?: string; client_secret?: string });
      clientId ||= c.client_id ?? "";
      clientSecret ||= c.client_secret ?? "";
    } catch {
      console.error("GOOGLE_OAUTH_JSON is not valid JSON");
    }
  }
  if (!clientId || !clientSecret) return null;
  const allowed = (e.ADMIN_EMAILS ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return { clientId, clientSecret, allowed };
}

function rand(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function secureFlag(request: Request): string {
  return new URL(request.url).protocol === "https:" ? "; Secure" : "";
}

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/** GET /auth/google — bounce to Google's consent screen. */
export function startGoogleLogin(request: Request, cfg: GoogleConfig): Response {
  const origin = new URL(request.url).origin;
  const state = rand();
  const nonce = rand();
  const u = new URL(AUTH_URL);
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("redirect_uri", origin + CALLBACK);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "openid email");
  u.searchParams.set("state", state);
  u.searchParams.set("nonce", nonce);
  u.searchParams.set("prompt", "select_account");
  return new Response(null, {
    status: 302,
    headers: {
      location: u.toString(),
      // SameSite=Lax is sent on the top-level GET redirect back from Google.
      "set-cookie": `${STATE_COOKIE}=${state}.${nonce}; Path=/auth/google; HttpOnly; SameSite=Lax; Max-Age=600${secureFlag(request)}`,
    },
  });
}

export type CallbackResult = { ok: true; headers: Headers } | { ok: false; error: string };

/** GET /auth/google/callback — exchange code, check email, set admin cookie. */
export async function finishGoogleLogin(
  request: Request,
  env: Env,
  cfg: GoogleConfig,
): Promise<CallbackResult> {
  const url = new URL(request.url);
  if (url.searchParams.get("error")) return { ok: false, error: `google: ${url.searchParams.get("error")}` };
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  const [wantState, nonce] = (readCookie(request, STATE_COOKIE) ?? "").split(".");
  if (!code || !wantState || !nonce || !(await safeEqual(state, wantState))) {
    return { ok: false, error: "login expired — try again" };
  }
  if (cfg.allowed.length === 0) {
    return { ok: false, error: "set Worker secret ADMIN_EMAILS to allow Google accounts" };
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: url.origin + CALLBACK,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    console.error("google token exchange failed", res.status, await res.text().catch(() => ""));
    return { ok: false, error: "google token exchange failed" };
  }
  const tok = (await res.json()) as { id_token?: string };
  const claims = decodeJwt(tok.id_token ?? "");
  if (!claims) return { ok: false, error: "bad id_token" };

  const now = Math.floor(Date.now() / 1000);
  const issOk = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
  if (!issOk || claims.aud !== cfg.clientId || typeof claims.exp !== "number" || claims.exp < now) {
    return { ok: false, error: "id_token rejected" };
  }
  if (claims.nonce !== nonce) return { ok: false, error: "id_token nonce mismatch" };
  const email = String(claims.email ?? "").toLowerCase();
  if (!email || claims.email_verified !== true) return { ok: false, error: "google email not verified" };
  if (!cfg.allowed.includes(email)) return { ok: false, error: `${email} is not allowed` };

  const token = (await resolveAdminToken(env)) ?? (await mintAdminToken(env)).token;
  const headers = new Headers({ location: "/admin" });
  headers.append("set-cookie", setCookie(request, token));
  headers.append("set-cookie", `${STATE_COOKIE}=; Path=/auth/google; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag(request)}`);
  return { ok: true, headers };
}

function decodeJwt(jwt: string): Record<string, unknown> | null {
  const part = jwt.split(".")[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  } catch {
    return null;
  }
}
