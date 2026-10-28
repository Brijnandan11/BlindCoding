import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { encodeRecord, decodeRecord } from "../lib/codec";
test("old JSON records and small session records remain readable", () => {
  const session = { participantId: "p", expires: 123456 };
  assert.deepEqual(decodeRecord(JSON.stringify(session)), session);
  assert.equal(encodeRecord(session), JSON.stringify(session));
});
test("large C drafts preserve every byte and revision after compression", () => {
  const record = { draft: "#include <stdio.h>\n/* café नमस्ते */\n".repeat(100), revision: 127 };
  const packed = encodeRecord(record);
  assert.ok(packed.startsWith("gz1:"));
  assert.ok(Buffer.byteLength(packed) < Buffer.byteLength(JSON.stringify(record)) / 2);
  assert.deepEqual(decodeRecord(packed), record);
});
test("corrupt or oversized compressed records fail instead of returning a damaged draft", () => {
  assert.throws(() => decodeRecord("gz1:invalid"));
  assert.throws(() => decodeRecord("gz1:" + gzipSync("x".repeat(300000)).toString("base64")));
});
