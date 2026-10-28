import { existsSync } from "node:fs";
import { Pool } from "pg";
for (const file of [".env.local", ".env"]) if (existsSync(file)) process.loadEnvFile(file);
if (!process.env.DATABASE_URL)
  throw new Error("Set DATABASE_URL to your Supabase PostgreSQL pooler URL first.");
const name = process.env.STORE_TABLE_ID || "records";
if (!/^[A-Za-z_][A-Za-z0-9_-]{0,62}$/.test(name)) throw new Error("Invalid database table name.");
const table = '"' + name + '"',
  index = '"' + name.slice(0, 50) + '_kind_idx"';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 5000,
});
try {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${table} (id varchar(32) PRIMARY KEY, kind varchar(32) NOT NULL, payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'), updated_at timestamptz NOT NULL DEFAULT now())`,
  );
  await pool.query(`CREATE INDEX IF NOT EXISTS ${index} ON ${table} (kind, id)`);
  console.log("PostgreSQL schema is ready. Existing records were preserved.");
} finally {
  await pool.end();
}
