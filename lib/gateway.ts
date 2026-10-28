import { createHash, timingSafeEqual } from "node:crypto";

export function validGatewayToken(value: string | null) {
  const expected = process.env.BACKEND_API_SECRET;
  if (!expected || !value) return false;
  return timingSafeEqual(
    createHash("sha256").update(expected).digest(),
    createHash("sha256").update(value).digest(),
  );
}

export function backendOrigin() {
  const value = process.env.BACKEND_URL;
  if (!value) return null;
  const url = new URL(value);
  if (
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(process.env.NODE_ENV !== "production" && url.protocol === "http:"))
  ) {
    throw new Error("BACKEND_URL must be an HTTPS origin.");
  }
  return url.origin;
}
