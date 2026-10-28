export class RequestBodyError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}
export async function readBoundedBody(body: ReadableStream<Uint8Array> | null, limit = 65536) {
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel().catch(() => {});
        throw new RequestBodyError("Request too large.", 413);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks, bytes).toString("utf8");
  } finally {
    reader.releaseLock();
  }
}
