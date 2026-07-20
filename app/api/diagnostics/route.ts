import { NextResponse } from "next/server";
import { DIAGNOSTIC_MAX_BYTES, clientDiagnosticSchema } from "@/game/schemas/diagnostics";
import { logClientDiagnostic } from "@/server/diagnostics";

const WINDOW_MS = 60_000;
const MAX_REPORTS = 30;
const visitors = new Map<string, { count: number; resetAt: number }>();
const noStore = { "cache-control": "no-store" };

function allowedRequest(request: Request) {
  const type = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!type.startsWith("application/json")) return false;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site" || fetchSite === "same-site") return false;
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function underLimit() {
  const now = Date.now();
  const key = "diagnostics";
  for (const [candidate, value] of visitors) if (value.resetAt <= now) visitors.delete(candidate);
  const value = visitors.get(key);
  if (!value || value.resetAt <= now) {
    visitors.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  value.count += 1;
  return value.count <= MAX_REPORTS;
}

async function readBoundedBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > DIAGNOSTIC_MAX_BYTES) return undefined;
      body += decoder.decode(chunk.value, { stream: true });
    }
    return body + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: Request) {
  if (!allowedRequest(request)) return new NextResponse(null, { status: 415, headers: noStore });
  const contentLength = Number(request.headers.get("content-length"));
  if (contentLength > DIAGNOSTIC_MAX_BYTES)
    return new NextResponse(null, { status: 413, headers: noStore });
  try {
    const body = await readBoundedBody(request);
    if (body === undefined) return new NextResponse(null, { status: 413, headers: noStore });
    const parsed = clientDiagnosticSchema.safeParse(JSON.parse(body));
    if (!parsed.success) return new NextResponse(null, { status: 400, headers: noStore });
    if (!underLimit())
      return new NextResponse(null, {
        status: 429,
        headers: { ...noStore, "retry-after": "60" },
      });
    logClientDiagnostic(parsed.data);
    return new NextResponse(null, { status: 204, headers: noStore });
  } catch {
    return new NextResponse(null, { status: 400, headers: noStore });
  }
}
