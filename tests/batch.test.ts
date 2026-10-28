import { test } from "node:test";
import assert from "node:assert/strict";
import { BatchQueue } from "../lib/batch";
test("batched operations wait for the durable write and share a remote call", async () => {
  let finish!: () => void;
  let started!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  const committed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let calls = 0,
    acknowledged = 0;
  const queue = new BatchQueue<number, number>(
    async (inputs) => {
      calls++;
      started();
      await committed;
      return inputs;
    },
    50,
    1,
    2,
  );
  const pending = [queue.add(1), queue.add(2), queue.add(3)].map((p) =>
    p.then((value) => {
      acknowledged++;
      return value;
    }),
  );
  await began;
  assert.equal(acknowledged, 0);
  finish();
  assert.deepEqual(await Promise.all(pending), [1, 2, 3]);
  assert.equal(calls, 1);
});
test("a burst respects remote concurrency and batch-size limits", async () => {
  let active = 0,
    peak = 0;
  const queue = new BatchQueue<number, number>(
    async (inputs) => {
      assert.ok(inputs.length <= 10);
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      return inputs.map((n) => n * 2);
    },
    10,
    1,
    2,
  );
  assert.deepEqual(
    await Promise.all(Array.from({ length: 100 }, (_, i) => queue.add(i))),
    Array.from({ length: 100 }, (_, i) => i * 2),
  );
  assert.ok(peak <= 2);
});
test("a failed batch rejects all waiters and subsequent batches can recover", async () => {
  let fail = true;
  const queue = new BatchQueue<number, number>(
    async (inputs) => {
      if (fail) throw new Error("write unavailable");
      return inputs;
    },
    10,
    1,
    1,
  );
  const results = await Promise.allSettled([queue.add(1), queue.add(2)]);
  assert.ok(results.every((result) => result.status === "rejected"));
  fail = false;
  assert.equal(await queue.add(3), 3);
});
