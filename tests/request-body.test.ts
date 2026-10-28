import { test } from "node:test";
import assert from "node:assert/strict";
import { readBoundedBody, RequestBodyError } from "../lib/request-body";
test("bounded request reading preserves multibyte text split across chunks", async () => {
  const bytes = Buffer.from(JSON.stringify({ source: "नमस्ते\nint main(){return 0;}" }));
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes.subarray(0, 13));
      c.enqueue(bytes.subarray(13));
      c.close();
    },
  });
  assert.equal(await readBoundedBody(stream), bytes.toString("utf8"));
});
test("chunked oversized bodies are cancelled before buffering the entire request", async () => {
  let pulls = 0,
    cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      pulls++;
      c.enqueue(new Uint8Array(32768));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    readBoundedBody(stream, 65536),
    (e: unknown) => e instanceof RequestBodyError && e.status === 413,
  );
  assert.equal(cancelled, true);
  assert.ok(pulls <= 4);
});
