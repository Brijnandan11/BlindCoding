import { gzipSync, gunzipSync } from "node:zlib";
const prefix = "gz1:";
export function encodeRecord(value: unknown): string {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json) < 1024) return json;
  const packed = prefix + gzipSync(json, { level: 1 }).toString("base64");
  return Buffer.byteLength(packed) < Buffer.byteLength(json) ? packed : json;
}
export function decodeRecord<T = unknown>(payload: string): T {
  const json = payload.startsWith(prefix)
    ? gunzipSync(Buffer.from(payload.slice(prefix.length), "base64"), {
        maxOutputLength: 262144,
      }).toString("utf8")
    : payload;
  return JSON.parse(json);
}
