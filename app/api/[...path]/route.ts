import { NextRequest, NextResponse } from "next/server";
import { backendOrigin, validGatewayToken } from "@/lib/gateway";
import { readBoundedBody, RequestBodyError } from "@/lib/request-body";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function route(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  try {
    if (
      req.method !== "GET" &&
      req.headers.get("origin") &&
      ![process.env.APP_URL || req.nextUrl.origin].includes(
        new URL(req.headers.get("origin")!).origin,
      )
    )
      return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
    if (Number(req.headers.get("content-length") || 0) > 65536)
      return NextResponse.json({ error: "Request too large." }, { status: 413 });
    const backend = backendOrigin();
    if (
      !backend &&
      process.env.REQUIRE_GATEWAY === "true" &&
      !validGatewayToken(req.headers.get("x-backend-token"))
    )
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const raw = req.method === "GET" ? "" : await readBoundedBody(req.body);
    if (Buffer.byteLength(raw) > 65536)
      return NextResponse.json({ error: "Request too large." }, { status: 413 });
    const path = (await params).path.join("/");
    if (backend) {
      if (!process.env.BACKEND_API_SECRET) throw new Error("Service unavailable.");
      try {
        const upstream = await fetch(`${backend}/api/${path}`, {
          method: req.method,
          headers: {
            "Content-Type": "application/json",
            Cookie: req.headers.get("cookie") || "",
            "X-Backend-Token": process.env.BACKEND_API_SECRET,
          },
          body: raw || undefined,
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(20000),
        });
        const response = new NextResponse(upstream.body, {
          status: upstream.status,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
        for (const cookie of upstream.headers.getSetCookie())
          response.headers.append("Set-Cookie", cookie);
        return response;
      } catch {
        return NextResponse.json(
          { error: "The contest service is temporarily unavailable. Please retry." },
          { status: 503 },
        );
      }
    }
    let body;
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      throw new RequestBodyError("Invalid JSON request.", 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new RequestBodyError("Request body must be a JSON object.", 400);
    const { handle } = await import("@/lib/server");
    const result = await handle(req.method, path, body);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof RequestBodyError)
      return NextResponse.json(
        { error: e.message },
        { status: e.status, headers: { "Cache-Control": "no-store" } },
      );
    const original = e instanceof Error ? e.message : "Request failed";
    const unavailable =
      /Service unavailable|aborted|timed out|ECONN|ETIMEDOUT|EAI_AGAIN|Command timed out/i.test(
        original,
      );
    if (
      !/Source is unavailable|already submitted|already in progress|authentication required|Please sign in/.test(
        original,
      )
    )
      console.error(
        "Contest request failed:",
        JSON.stringify({ message: original, code: (e as { code?: unknown }).code }),
      );
    const message = unavailable
      ? "The contest service is temporarily unavailable. Please retry."
      : original;
    return NextResponse.json(
      { error: message },
      {
        status: unavailable
          ? 503
          : /Too many login/.test(message)
            ? 429
            : /sign in|authentication/.test(message)
              ? 401
              : message.includes("Source is unavailable")
                ? 403
                : message.includes("already submitted") ||
                    message.includes("submission is locked") ||
                    message.includes("already in progress") ||
                    (e as { code?: number }).code === 409
                  ? 409
                  : 400,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
export { route as GET, route as POST, route as PUT };
