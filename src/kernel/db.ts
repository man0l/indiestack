import type { Job, Monitor } from "./types";

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(key, value)
    .run();
}

export async function listMonitors(db: D1Database): Promise<Monitor[]> {
  const { results } = await db
    .prepare("SELECT * FROM monitors ORDER BY created_at ASC")
    .all<Monitor>();
  return results ?? [];
}

export async function listJobs(db: D1Database): Promise<Job[]> {
  const { results } = await db.prepare("SELECT * FROM jobs ORDER BY created_at ASC").all<Job>();
  return results ?? [];
}
