import { getSetting, setSetting } from "./db";

export type Channels = {
  webhook: string | null;
  telegramToken: string | null;
  telegramChat: string | null;
  resendKey: string | null;
  alertEmail: string | null;
  alertFrom: string | null;
};

const SETTING_KEYS = [
  "webhook_url",
  "telegram_bot_token",
  "telegram_chat_id",
  "resend_api_key",
  "alert_email",
  "alert_from",
] as const;

/** Settings the admin settings form edits (alert channels). */
export const ALERT_SETTING_KEYS: readonly string[] = SETTING_KEYS;

export async function loadChannels(env: Env): Promise<Channels> {
  const [webhook, telegramToken, telegramChat, resendKey, alertEmail, alertFrom] =
    await Promise.all(SETTING_KEYS.map((key) => getSetting(env.DB, key)));
  return {
    webhook,
    telegramToken,
    telegramChat,
    resendKey,
    alertEmail,
    alertFrom,
  };
}

export function channelsConfigured(ch: Channels): number {
  let n = 0;
  if (ch.webhook) n++;
  if (ch.telegramToken && ch.telegramChat) n++;
  if (ch.resendKey && ch.alertEmail) n++;
  return n;
}

const ALERT_ERROR_KEY = "last_alert_error";

async function recordAlertError(env: Env, message: string): Promise<void> {
  await setSetting(env.DB, ALERT_ERROR_KEY, `${Date.now()} · ${message.slice(0, 160)}`).catch(
    () => {},
  );
}

/** Fan one batch of alert texts out to every configured channel. Counts deliveries.
 *  Delivery failures land in settings.last_alert_error (shown in /admin). */
export async function notifyAll(env: Env, texts: string[]): Promise<number> {
  if (texts.length === 0) return 0;
  const ch = await loadChannels(env);
  const active: Array<{ label: string; send: (text: string) => Promise<void> }> = [];
  if (ch.webhook) active.push({ label: "webhook", send: (t) => sendAlert(ch.webhook!, t) });
  if (ch.telegramToken && ch.telegramChat) {
    active.push({
      label: "telegram",
      send: (t) => sendTelegram(ch.telegramToken!, ch.telegramChat!, t),
    });
  }
  if (ch.resendKey && ch.alertEmail) {
    active.push({
      label: "email",
      send: (t) => sendEmail(ch.resendKey!, ch.alertEmail!, ch.alertFrom, t),
    });
  }
  if (active.length === 0) return 0;
  let n = 0;
  let firstError: string | null = null;
  for (const text of texts) {
    for (const channel of active) {
      try {
        await channel.send(text);
        n++;
      } catch (err) {
        if (!firstError) firstError = `${channel.label}: ${String(err)}`;
        console.error("alert failed", channel.label, String(err));
      }
    }
  }
  if (firstError) await recordAlertError(env, firstError);
  return n;
}

/** Sends a test text through every channel. Returns what happened for the admin flash. */
export async function sendTestAlert(env: Env): Promise<{ delivered: number; error: string | null }> {
  const text = `TEST · ${new Date().toISOString()} · if you can read this, the channel works.`;
  const ch = await loadChannels(env);
  if (channelsConfigured(ch) === 0) {
    return { delivered: 0, error: "no channel configured" };
  }
  const delivered = await notifyAll(env, [text]);
  if (delivered === 0) {
    const stored = await getSetting(env.DB, ALERT_ERROR_KEY);
    return { delivered: 0, error: stored ?? "all channels failed" };
  }
  return { delivered, error: null };
}

export async function lastAlertError(env: Env): Promise<string | null> {
  return getSetting(env.DB, ALERT_ERROR_KEY);
}

export async function clearAlertError(env: Env): Promise<void> {
  await env.DB.prepare("DELETE FROM settings WHERE key = ?").bind(ALERT_ERROR_KEY).run();
}

export async function sendAlert(webhook: string, text: string): Promise<void> {
  const discord = webhook.includes("discord.com");
  const payload = discord ? { content: text } : { text };
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (res.body) await res.body.cancel();
  if (!res.ok) throw new Error(`webhook ${res.status}`);
}

export async function sendTelegram(token: string, chatId: string, text: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (res.body) await res.body.cancel();
  if (!res.ok) throw new Error(`telegram ${res.status}`);
}

export async function sendEmail(
  resendKey: string,
  to: string,
  from: string | null,
  text: string,
): Promise<void> {
  const subject = text.split("\n")[0].slice(0, 78) || "indiestack alert";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${resendKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: from || "onboarding@resend.dev",
      to: [to],
      subject,
      text,
    }),
  });
  if (res.body) await res.body.cancel();
  if (!res.ok) throw new Error(`email ${res.status}`);
}
