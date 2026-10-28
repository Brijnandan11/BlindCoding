import Redis from "ioredis";
import { storageNamespace } from "./storage-namespace";
let connection: Redis | undefined;
const pending = new Map<string, Promise<unknown>>();
const namespace = storageNamespace();
export const cacheKey = (key: string) => `bc:${namespace}:${key}`;
export function redis() {
  if (!process.env.REDIS_URL) throw new Error("Service unavailable. Redis is required.");
  if (!connection) {
    connection = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      commandTimeout: 3000,
      lazyConnect: true,
    });
    connection.on("error", () => {});
  }
  return connection;
}
export async function cached<T>(
  key: string,
  ttl: number | ((result: T) => number),
  loader: () => Promise<T>,
): Promise<T> {
  const client = redis();
  const value = await client.get(cacheKey(key));
  if (value !== null) return JSON.parse(value);
  const inflight = pending.get(key);
  if (inflight) return inflight as Promise<T>;
  const promise = (async () => {
    const result = await loader();
    // A concurrent write/logout tombstone always wins over an older read.
    await client.set(
      cacheKey(key),
      JSON.stringify(result),
      "EX",
      typeof ttl === "number" ? ttl : ttl(result),
      "NX",
    );
    return result;
  })();
  pending.set(key, promise);
  try {
    return await promise;
  } finally {
    if (pending.get(key) === promise) pending.delete(key);
  }
}
export async function cacheWrite(key: string, value: unknown, ttl: number) {
  await redis().set(cacheKey(key), JSON.stringify(value), "EX", ttl);
}
export async function cacheDelete(...keys: string[]) {
  if (keys.length) await redis().del(...keys.map(cacheKey));
}

export async function withRecordLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  const client = redis();
  const token = crypto.randomUUID();
  const name = cacheKey("lock:" + key);
  if ((await client.set(name, token, "PX", 90000, "NX")) !== "OK")
    throw new Error("An update is already in progress. Please retry.");
  const renewal = setInterval(() => {
    client
      .eval(
        "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE',KEYS[1],90000) end; return 0",
        1,
        name,
        token,
      )
      .catch(() => {});
  }, 15000);
  try {
    return await action();
  } finally {
    clearInterval(renewal);
    await client
      .eval(
        "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) end; return 0",
        1,
        name,
        token,
      )
      .catch(() => {});
  }
}
