export function redirect(location: string, headers?: HeadersInit): Response {
  return new Response(null, {
    status: 303,
    headers: { location, ...headers },
  });
}

export async function toggleEnabled(db: D1Database, table: string, id: string): Promise<void> {
  await db.prepare(`UPDATE ${table} SET enabled = 1 - enabled WHERE id = ?`).bind(id).run();
}
