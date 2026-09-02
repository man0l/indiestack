import { setSetting, getSetting } from "../kernel/db";
import type { Plugin, RouteCtx, SectionCtx } from "../kernel/plugin";
import { esc, ago } from "../ui";
import { firstTouch, identifyHash, siteByToken } from "../analytics";

type Payment = {
  id: string;
  site_id: string;
  ts: number;
  amount_cents: number;
  currency: string;
  ident: string | null;
  source_ref: string | null;
  source_path: string | null;
  external_id: string | null;
  customer: string | null;
};

const MAX_PAYMENT_BYTES = 16 * 1024;

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function recordPayment(
  env: Env,
  siteId: string,
  p: {
    amount_cents: number;
    currency: string;
    email: string | null;
    external_id: string | null;
    customer: string | null;
    ts: number;
  },
): Promise<boolean> {
  const ident = p.email ? await identifyHash(env, p.email) : null;
  const touch = ident ? await firstTouch(env, siteId, ident) : null;
  const res = await env.DB.prepare(
    `INSERT OR IGNORE INTO payments (
       id, site_id, ts, amount_cents, currency, ident, source_ref, source_path, external_id, customer
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      siteId,
      p.ts,
      p.amount_cents,
      p.currency.slice(0, 8).toUpperCase(),
      ident,
      touch?.ref ?? null,
      touch?.path ?? null,
      p.external_id,
      p.customer?.slice(0, 120) ?? null,
    )
    .run();
  return (res.meta.changes ?? 0) > 0;
}

async function paymentsList(db: D1Database, limit = 20): Promise<Payment[]> {
  const { results } = await db
    .prepare("SELECT * FROM payments ORDER BY ts DESC LIMIT ?")
    .bind(limit)
    .all<Payment>();
  return results ?? [];
}

function money(cents: number, currency: string): string {
  return `${(cents / 100).toFixed(2)} ${currency}`;
}

export const revenue: Plugin = {
  id: "revenue",
  deps: ["analytics"],
  adminFooter: "Payments attribute to the first referrer of the identified visitor. Revenue numbers leave your Worker only via your own dashboard links.",
  async adminSection(ctx: SectionCtx) {
    const [payments, secret] = await Promise.all([
      paymentsList(ctx.env.DB),
      getSetting(ctx.env.DB, "stripe_webhook_secret"),
    ]);
    const rows = payments
      .map(
        (p) => `<div class="row">
          <div class="dot up"></div>
          <div>
            <div class="name">${esc(money(p.amount_cents, p.currency))}${p.source_ref ? ` · from ${esc(p.source_ref)}` : " · direct"}</div>
            <div class="url">${esc(p.source_path ?? "")}${p.customer ? ` · ${esc(p.customer)}` : ""} · ${esc(ago(p.ts))}</div>
          </div>
          <div class="meta"></div>
        </div>`,
      )
      .join("");

    const totals = await ctx.env.DB.prepare(
      `SELECT COUNT(*) AS n, SUM(amount_cents) AS cents FROM payments WHERE ts >= ?`,
    )
      .bind(Date.now() - 30 * 86400000)
      .first<{ n: number; cents: number | null }>();

    const bySource = await ctx.env.DB.prepare(
      `SELECT COALESCE(source_ref, 'direct') AS src, COUNT(*) AS n, SUM(amount_cents) AS cents
       FROM payments WHERE ts >= ? GROUP BY src ORDER BY cents DESC LIMIT 8`,
    )
      .bind(Date.now() - 30 * 86400000)
      .all<{ src: string; n: number; cents: number }>();

    const srcRows =
      bySource.results?.length === 0
        ? `<span class="url">no payments yet</span>`
        : bySource.results
            ?.map(
              (r) =>
                `<div class="url">${esc(r.src)} · ${r.n} payment(s) · ${esc(money(Number(r.cents), "USD"))}</div>`,
            )
            .join("") ?? "";

    return `<h2>revenue</h2>
    <div class="card">
      <p class="sub" style="margin:0 0 8px">30 days: <b>${totals?.n ?? 0}</b> payments · <b>${esc(money(Number(totals?.cents ?? 0), "USD"))}</b> · by source:</p>
      ${srcRows}
    </div>
    <div class="list">${rows || `<p class="sub">No payments yet.</p>`}</div>
    <form class="card" method="post" action="/admin/revenue/secret">
      <label>Stripe webhook signing secret (whsec_…)
        <input type="password" name="secret" value="${esc(secret ?? "")}" placeholder="whsec_…"/>
      </label>
      <button type="submit">save secret</button>
      <p class="sub" style="margin:10px 0 0">Point a Stripe webhook at <code>${esc(ctx.origin)}/stripe/&lt;site token&gt;</code> for <code>checkout.session.completed</code> and <code>invoice.paid</code>. On your success page call <code>df.identify("email")</code> — that links the payment to its first referrer.</p>
    </form>`;
  },
  async admin(ctx: RouteCtx) {
    if (ctx.path === "/admin/revenue/secret" && ctx.method === "POST") {
      const form = await ctx.request.formData();
      const secret = String(form.get("secret") ?? "").trim();
      if (secret) {
        await setSetting(ctx.env.DB, "stripe_webhook_secret", secret.slice(0, 200));
      } else {
        await ctx.env.DB.prepare("DELETE FROM settings WHERE key = 'stripe_webhook_secret'").run();
      }
      const { redirect } = await import("../kernel/http");
      return redirect("/admin?msg=revenue%20secret%20saved");
    }
    return null;
  },
  async route(ctx: RouteCtx) {
    const { path, method, env, request } = ctx;
    if (method !== "POST") return null;

    // Stripe webhook: /stripe/<site token>
    const stripe = path.match(/^\/stripe\/([A-Za-z0-9_-]+)$/);
    if (stripe) {
      const site = await siteByToken(env.DB, stripe[1]);
      if (!site) return Response.json({ error: "unknown site" }, { status: 404 });
      const secret = await getSetting(env.DB, "stripe_webhook_secret");
      if (!secret) return Response.json({ error: "webhook secret not configured" }, { status: 400 });
      const payload = await request.text().then((t) => t.slice(0, MAX_PAYMENT_BYTES * 16));
      const sigHeader = request.headers.get("stripe-signature") ?? "";
      const parts = Object.fromEntries(
        sigHeader.split(",").map((kv) => kv.split("=") as [string, string]),
      );
      const t = parts.t;
      const v1 = parts.v1;
      if (!t || !v1 || Math.abs(Date.now() / 1000 - Number(t)) > 300) {
        return Response.json({ error: "bad signature" }, { status: 400 });
      }
      const expected = await hmacHex(secret, `${t}.${payload}`);
      if (!timingSafeEq(expected, v1)) {
        return Response.json({ error: "bad signature" }, { status: 400 });
      }
      let event: {
        id?: string;
        type?: string;
        data?: { object?: Record<string, unknown> };
      };
      try {
        event = JSON.parse(payload);
      } catch {
        return Response.json({ error: "bad payload" }, { status: 400 });
      }
      const obj = event.data?.object ?? {};
      let amount: number | null = null;
      let currency: string | null = null;
      let email: string | null = null;
      if (event.type === "checkout.session.completed") {
        amount = Number(obj.amount_total);
        currency = typeof obj.currency === "string" ? obj.currency : null;
        const details = obj.customer_details as { email?: string } | undefined;
        email = details?.email ?? (typeof obj.customer_email === "string" ? obj.customer_email : null);
      } else if (event.type === "invoice.paid") {
        amount = Number(obj.amount_paid);
        currency = typeof obj.currency === "string" ? obj.currency : null;
        email = typeof obj.customer_email === "string" ? obj.customer_email : null;
      } else {
        return Response.json({ received: true, ignored: event.type ?? "unknown" });
      }
      if (amount == null || !Number.isFinite(amount) || !currency) {
        return Response.json({ error: "missing amount/currency" }, { status: 400 });
      }
      const inserted = await recordPayment(env, site.id, {
        amount_cents: Math.round(amount),
        currency,
        email,
        external_id: event.id ?? null,
        customer: email,
        ts: Date.now(),
      });
      return Response.json({ received: true, duplicate: !inserted });
    }

    // Payment API for custom providers: /revenue/<site token>
    const api = path.match(/^\/revenue\/([A-Za-z0-9_-]+)$/);
    if (api) {
      const site = await siteByToken(env.DB, api[1]);
      if (!site) return Response.json({ error: "unknown site" }, { status: 404 });
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(await request.text().then((t) => t.slice(0, MAX_PAYMENT_BYTES)));
      } catch {
        return Response.json({ error: "bad json" }, { status: 400 });
      }
      const amount = Number(body.amount_cents);
      if (!Number.isFinite(amount) || amount <= 0) {
        return Response.json({ error: "amount_cents required" }, { status: 400 });
      }
      const inserted = await recordPayment(env, site.id, {
        amount_cents: Math.round(amount),
        currency: typeof body.currency === "string" ? body.currency : "USD",
        email: typeof body.email === "string" ? body.email : null,
        external_id: typeof body.id === "string" ? body.id : null,
        customer: typeof body.customer === "string" ? body.customer : null,
        ts: Date.now(),
      });
      return Response.json({ ok: true, duplicate: !inserted });
    }
    return null;
  },
};
