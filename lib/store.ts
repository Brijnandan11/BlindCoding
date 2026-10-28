import { createHash } from "node:crypto";
import { BatchQueue } from "./batch";
import { cached, cacheWrite } from "./cache";
import { sqlRead, sqlUpsert, sqlCreate, postgres, sqlTable } from "./postgres";
import { isDeepStrictEqual } from "node:util";
export const usePostgres = !!process.env.DATABASE_URL;
export const live = usePostgres;
export const tableId = process.env.STORE_TABLE_ID || "records";
export const recordId = (kind: string, id: string) =>
  createHash("sha256")
    .update(kind + ":" + id)
    .digest("hex")
    .slice(0, 32);
const ttl = (kind: string) => (kind === "submission" ? 30 : kind === "attempt" ? 30 : 60);
const key = (kind: string, id: string) => `record:${kind}:${id}`;
const reads = new BatchQueue<{ kind: string; id: string }, unknown>(
  async (items) => {
    const ids = [...new Set(items.map((item) => recordId(item.kind, item.id)))];
    const rows = new Map((await sqlRead(ids)).map((row) => [row.id, row]));
    return items.map((item) => {
      const row = rows.get(recordId(item.kind, item.id));
      return row?.kind === item.kind ? row.payload : null;
    });
  },
  100,
  10,
  16,
);
// Upserts contain full records with fixed IDs, so retries are idempotent.
const writes = new BatchQueue<{ kind: string; id: string; value: unknown }, void>(
  async (items) => {
    const unique = new Map<string, (typeof items)[number]>();
    for (const item of items) unique.set(recordId(item.kind, item.id), item);
    await sqlUpsert(
      [...unique.entries()].map(([id, item]) => ({ id, kind: item.kind, value: item.value })),
    );
    return items.map(() => undefined);
  },
  50,
  10,
  8,
);
export async function get<T>(kind: string, id: string): Promise<T | null> {
  return cached(
    key(kind, id),
    (value) => (kind === "submission" && value === null ? 120 : ttl(kind)),
    () => reads.add({ kind, id }),
  ) as Promise<T | null>;
}
export async function create<T>(kind: string, id: string, value: T) {
  const rowId = recordId(kind, id);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await sqlCreate(rowId, kind, value);
      break;
    } catch (error) {
      const code = (error as { code?: number | string }).code;
      if (typeof code === "number" && code < 429 && code !== 409) throw error;
      if (code === 409 && attempt === 0) throw error;
      const saved = (await sqlRead([rowId]).catch(() => []))[0]?.payload;
      if (isDeepStrictEqual(saved, value)) break;
      if (code === 409 || attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
  await cacheWrite(key(kind, id), value, ttl(kind));
  return value;
}
export async function put<T>(kind: string, id: string, value: T) {
  await writes.add({ kind, id, value });
  await cacheWrite(key(kind, id), value, ttl(kind));
}
export async function list<T>(kind: string): Promise<T[]> {
  return (
    await postgres().query(`SELECT payload FROM ${sqlTable()} WHERE kind=$1 ORDER BY id`, [kind])
  ).rows.map((row) => row.payload as T);
}
export async function remove(kind: string, id: string) {
  // The tombstone prevents a read already in flight from repopulating a revoked session.
  await cacheWrite(key(kind, id), null, kind === "session" ? 86400 : ttl(kind));
  try {
    await postgres().query(`DELETE FROM ${sqlTable()} WHERE id=$1`, [recordId(kind, id)]);
  } catch (error) {
    if ((error as { code?: number }).code !== 404) throw error;
  }
}

export async function createGroup(items: { kind: string; id: string; value: unknown }[]) {
  const { sqlCreateMany } = await import("./postgres");
  await sqlCreateMany(items.map((item) => ({ ...item, id: recordId(item.kind, item.id) })));
  await Promise.all(
    items.map((item) => cacheWrite(key(item.kind, item.id), item.value, ttl(item.kind))),
  );
}
