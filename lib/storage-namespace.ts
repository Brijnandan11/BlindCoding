import { createHash } from "node:crypto";
export function storageNamespace(env: Readonly<Record<string, string | undefined>> = process.env) {
  const table = env.STORE_TABLE_ID || "records";
  const identity = env.STORE_NAMESPACE
    ? [env.STORE_NAMESPACE, table].join(":")
    : env.DATABASE_URL
      ? (() => {
          const url = new URL(env.DATABASE_URL!);
          return ["postgres", url.host, url.pathname, table].join(":");
        })()
      : ["postgres", table].join(":");
  return createHash("sha256").update(identity).digest("hex").slice(0, 20);
}
