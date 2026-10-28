import Redis from "ioredis";
import { createHash } from "node:crypto";
let client: Redis | undefined;
export async function checkLoginLimit(key: string) {
  if (!process.env.REDIS_URL) throw new Error("Service unavailable.");
  if (!client) {
    client = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 5000,
      lazyConnect: true,
    });
    client.on("error", () => {});
  }
  const bucket = "bc:login:" + createHash("sha256").update(key).digest("hex");
  let count: number;
  try {
    count = Number(
      await client.eval(
        "local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], 60) end; return n",
        1,
        bucket,
      ),
    );
  } catch {
    throw new Error("Service unavailable.");
  }
  if (count > 20) throw new Error("Too many login attempts. Wait one minute and retry.");
}
