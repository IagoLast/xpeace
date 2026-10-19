import "server-only";
import { neon } from "@neondatabase/serverless";
import { required } from "./config";

export async function query<T>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await neon(required("DATABASE_URL")).query(sql, params)) as T[];
}

export async function withAccountLock<T>(
  accountId: string,
  work: () => Promise<T>,
): Promise<T> {
  const owner = crypto.randomUUID();
  const rows = await query<{ owner: string }>(
    `
    INSERT INTO locks (id, owner, expires_at) VALUES ($1, $2, now() + interval '120 seconds')
    ON CONFLICT (id) DO UPDATE SET owner = EXCLUDED.owner, expires_at = EXCLUDED.expires_at
    WHERE locks.expires_at < now() RETURNING owner`,
    [accountId, owner],
  );
  if (!rows.length) throw new BusyError();
  try {
    return await work();
  } finally {
    await query("DELETE FROM locks WHERE id = $1 AND owner = $2", [
      accountId,
      owner,
    ]);
  }
}

export class BusyError extends Error {
  constructor() {
    super("Ya hay una tarea en curso. Espera unos segundos.");
  }
}
