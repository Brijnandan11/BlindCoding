import { createHash } from "node:crypto";
import { Pool } from "pg";
import { cacheDelete, cacheWrite } from "./cache";
let pool: Pool | undefined;
export function sqlIdentifier(value: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_-]{0,62}$/.test(value))
    throw new Error("Invalid database table name.");
  return '"' + value + '"';
}
export function postgres() {
  if (!process.env.DATABASE_URL) throw new Error("Service unavailable. DATABASE_URL is required.");
  if (!pool) {
    const max = Number(process.env.PG_POOL_MAX || 10);
    if (!Number.isInteger(max) || max < 1 || max > 50)
      throw new Error("PG_POOL_MAX must be between 1 and 50.");
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      statement_timeout: 10000,
      application_name: "blind-coding",
    });
    pool.on("error", (error) => console.error("PostgreSQL idle connection error:", error.message));
  }
  return pool;
}
export const sqlTable = () => sqlIdentifier(process.env.STORE_TABLE_ID || "records");
export async function initializePostgres() {
  const table = sqlTable();
  const index = sqlIdentifier(
    (process.env.STORE_TABLE_ID || "records").slice(0, 50) +
      "_kind_idx",
  );
  await postgres().query(
    `CREATE TABLE IF NOT EXISTS ${table} (id varchar(32) PRIMARY KEY, kind varchar(32) NOT NULL, payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'), updated_at timestamptz NOT NULL DEFAULT now())`,
  );
  await postgres().query(`CREATE INDEX IF NOT EXISTS ${index} ON ${table} (kind, id)`);
}
export async function sqlRead(ids: string[]) {
  return (
    await postgres().query(
      `SELECT id, kind, payload FROM ${sqlTable()} WHERE id = ANY($1::varchar[])`,
      [ids],
    )
  ).rows;
}
export async function sqlUpsert(items: { id: string; kind: string; value: unknown }[]) {
  if (!items.length) return;
  const values: unknown[] = [];
  const rows = items.map((item, index) => {
    values.push(item.id, item.kind, JSON.stringify(item.value));
    return `($${index * 3 + 1},$${index * 3 + 2},$${index * 3 + 3}::jsonb)`;
  });
  await postgres().query(
    `INSERT INTO ${sqlTable()} (id,kind,payload) VALUES ${rows.join(",")} ON CONFLICT (id) DO UPDATE SET kind=EXCLUDED.kind,payload=EXCLUDED.payload,updated_at=now()`,
    values,
  );
}
export async function sqlCreate(id: string, kind: string, value: unknown) {
  try {
    await postgres().query(`INSERT INTO ${sqlTable()} (id,kind,payload) VALUES ($1,$2,$3::jsonb)`, [
      id,
      kind,
      JSON.stringify(value),
    ]);
  } catch (error) {
    if ((error as { code?: string }).code === "23505")
      throw Object.assign(new Error("This record already exists."), { code: 409 });
    throw error;
  }
}
export async function closePostgres() {
  await pool?.end();
  pool = undefined;
}
export async function sqlCreateMany(items: { id: string; kind: string; value: unknown }[]) {
  if (!items.length) return;
  const parameters: unknown[] = [];
  const rows = items.map((item, index) => {
    parameters.push(item.id, item.kind, JSON.stringify(item.value));
    return `($${index * 3 + 1},$${index * 3 + 2},$${index * 3 + 3}::jsonb)`;
  });
  try {
    await postgres().query(
      `INSERT INTO ${sqlTable()} (id,kind,payload) VALUES ${rows.join(",")}`,
      parameters,
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505")
      throw Object.assign(new Error("A team or participant record already exists."), { code: 409 });
    throw error;
  }
}

export async function sqlCreateParticipantForTeam(
  participantId: string,
  participant: unknown,
  teamId: string,
  teamName: string,
) {
  const participantRowId = createRecordId("participant", participantId);
  const teamRowId = createRecordId("team", teamId);
  const table = sqlTable();
  const client = await postgres().connect();
  try {
    await client.query("BEGIN");
    const teamResult = await client.query(
      `SELECT payload FROM ${table} WHERE id=$1 AND kind='team' FOR UPDATE`,
      [teamRowId],
    );
    const team = teamResult.rows[0]?.payload as { id?: string; name?: string; participants?: string[] } | undefined;
    if (!team || team.name?.trim().toLowerCase() !== teamName.trim().toLowerCase())
      throw new Error("Team not found. Check the team name with your organizer.");
    const duplicate = await client.query(
      `SELECT 1 FROM ${table} WHERE kind='participant' AND lower(payload->>'name')=lower($1) AND payload->>'teamId'=$2 LIMIT 1`,
      [(participant as { name: string }).name, team.id],
    );
    if (duplicate.rowCount) throw Object.assign(new Error("That name is already registered for this team."), { code: 409 });
    await client.query(
      `INSERT INTO ${table}(id,kind,payload) VALUES ($1,'participant',$2::jsonb)`,
      [participantRowId, JSON.stringify(participant)],
    );
    await client.query(
      `UPDATE ${table} SET payload=jsonb_set(payload,'{participants}',coalesce(payload->'participants','[]'::jsonb) || jsonb_build_array($2::text)),updated_at=now() WHERE id=$1 AND kind='team'`,
      [teamRowId, participantId],
    );
    await client.query("COMMIT");
    team.participants = [...(team.participants || []), participantId];
    await cacheWrite("record:team:" + teamId, team, 60);
    await cacheWrite("record:participant:" + participantId, participant, 60);
    await cacheDelete("participants-for-login", "teams-for-registration");
    return team.name;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function createRecordId(kind: string, id: string) {
  return createHash("sha256").update(kind + ":" + id).digest("hex").slice(0, 32);
}
