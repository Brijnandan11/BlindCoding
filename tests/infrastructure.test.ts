import { test } from "node:test";
import assert from "node:assert/strict";
import { recordId } from "../lib/store";
import { redisConnection } from "../lib/redis";
test("shared PostgreSQL table namespaces logical IDs by record type", () => {
  const attempt = recordId("attempt", "same-logical-id"),
    submission = recordId("submission", "same-logical-id");
  assert.notEqual(attempt, submission);
  assert.equal(attempt, recordId("attempt", "same-logical-id"));
  assert.match(attempt, /^[a-f0-9]{32}$/);
});
test("Redis configuration preserves TLS, credentials and database", () => {
  const config = redisConnection("rediss://judge:p%40ss@example.test:6380/3");
  assert.equal(config.password, "p@ss");
  assert.equal(config.username, "judge");
  assert.equal(config.db, 3);
  assert.equal(config.port, 6380);
  assert.deepEqual(config.tls, {});
  assert.throws(() => redisConnection("https://example.test"));
});
