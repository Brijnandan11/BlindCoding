import { storageNamespace } from "../lib/storage-namespace";
import { test } from "node:test";
import assert from "node:assert/strict";
import { sqlIdentifier } from "../lib/postgres";
test("PostgreSQL table identifiers reject SQL injection and quote isolated fixture names", () => {
  assert.equal(sqlIdentifier("records"), '"records"');
  assert.equal(sqlIdentifier("load-20261027-fixture"), '"load-20261027-fixture"');
  for (const value of [
    'records"; DROP TABLE records;--',
    "public.records",
    "../records",
    "",
    "a".repeat(64),
  ])
    assert.throws(() => sqlIdentifier(value));
});

test("internal and external database URLs share a cache only with an explicit environment namespace", () => {
  const backend = {
    DATABASE_URL: "postgres://user:secret@internal/contest",
    STORE_NAMESPACE: "event-production",
    STORE_TABLE_ID: "records",
  };
  const judge = { ...backend, DATABASE_URL: "postgres://user:secret@external.example/contest" };
  assert.equal(storageNamespace(backend), storageNamespace(judge));
  assert.notEqual(
    storageNamespace(backend),
    storageNamespace({ ...backend, STORE_NAMESPACE: "event-staging" }),
  );
  assert.notEqual(
    storageNamespace(backend),
    storageNamespace({ ...backend, STORE_TABLE_ID: "load-fixture" }),
  );
});
