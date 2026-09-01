export async function flushAlerts(webhook: string | null, texts: string[]): Promise<number> {
  if (!webhook || texts.length === 0) return 0;
  let n = 0;
  for (const text of texts) {
    try {
      await sendAlert(webhook, text);
      n++;
    } catch (err) {
      console.error("alert failed", String(err));
    }
  }
  return n;
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
