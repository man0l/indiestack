import type { LogEvent, LogSource } from "./index";

const MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";

export async function analyzeLogs(
  env: Env,
  source: LogSource,
  events: LogEvent[],
): Promise<{ text: string } | { error: string }> {
  if (events.length === 0) return { error: "No events in the last 24h." };
  const lines = events
    .slice(0, 50)
    .map((e) => {
      const t = new Date(e.ts).toISOString();
      return `${t} [${e.level ?? "log"}] ${e.message}`;
    })
    .join("\n");
  try {
    const out = await env.AI.run(MODEL, {
      messages: [
        {
          role: "system",
          content:
            "You summarize application error logs for a solo developer. Be concrete. Do not invent events that are not in the list. Short bullets: what happened, likely cause, what to check next. At most 12 lines. No preamble.",
        },
        {
          role: "user",
          content: `Source: ${source.name}\nLast ${Math.min(events.length, 50)} events, newest first:\n${lines}`,
        },
      ],
      max_tokens: 400,
      temperature: 0.2,
    });
    const text = extractText(out).trim();
    if (!text) return { error: "Empty model response." };
    return { text };
  } catch (err) {
    return { error: trunc(String(err), 200) };
  }
}

function extractText(out: unknown): string {
  if (typeof out === "string") return out;
  if (!out || typeof out !== "object") return "";
  const o = out as Record<string, unknown>;
  if (typeof o.response === "string") return o.response;
  const choices = o.choices as Array<{ message?: { content?: string } }> | undefined;
  const content = choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  return "";
}

function trunc(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}
