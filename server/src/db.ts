import pg from "pg";

// DATE columns (retest eligible_from_date, certificate valid_from/valid_to) must
// round-trip as plain 'YYYY-MM-DD' strings. pg's default parser builds a local-
// timezone Date object from that string, which JSON serialization then converts
// to UTC — shifting the calendar day whenever the server's local zone isn't UTC.
pg.types.setTypeParser(pg.types.builtins.DATE, (val: string) => val);

const connectionString =
  process.env.DATABASE_URL || "postgresql://oworkly:oworkly_dev_pw@localhost:5433/oworkly_lms";

export const pool = new pg.Pool({ connectionString });

export async function query<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}

export async function queryOne<T = any>(text: string, params: any[] = []): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
