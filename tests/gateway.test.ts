import { test } from "node:test";
import assert from "node:assert/strict";
import { backendOrigin, validGatewayToken } from "../lib/gateway";
test("gateway refuses missing and incorrect shared secrets", () => {
  const old = process.env.BACKEND_API_SECRET;
  try {
    delete process.env.BACKEND_API_SECRET;
    assert.equal(validGatewayToken(null), false);
    process.env.BACKEND_API_SECRET = "a-long-test-only-shared-secret";
    assert.equal(validGatewayToken("incorrect"), false);
    assert.equal(validGatewayToken(process.env.BACKEND_API_SECRET), true);
  } finally {
    if (old === undefined) delete process.env.BACKEND_API_SECRET;
    else process.env.BACKEND_API_SECRET = old;
  }
});
test("backend configuration rejects credentials and URL paths", () => {
  const old = process.env.BACKEND_URL;
  try {
    process.env.BACKEND_URL = "https://api.example.test";
    assert.equal(backendOrigin(), "https://api.example.test");
    for (const value of [
      "https://api.example.test/path",
      "https://user:password@api.example.test",
      "https://api.example.test?query=1",
    ]) {
      process.env.BACKEND_URL = value;
      assert.throws(backendOrigin);
    }
  } finally {
    if (old === undefined) delete process.env.BACKEND_URL;
    else process.env.BACKEND_URL = old;
  }
});
