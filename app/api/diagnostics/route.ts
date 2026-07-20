import { NextResponse } from "next/server";
import {
  DIAGNOSTIC_MAX_BYTES,
  clientDiagnosticSchema,
} from "@/game/schemas/diagnostics";
import { logClientDiagnostic } from "@/server/diagnostics";

const WINDOW_MS = 60_000;
const MAX_REPORTS = 30;
const MAX_CLIENTS = 256;
const visitors = new Map<string, { count: number; resetAt: number }>();
const noStore = { "cache-control": "no-store" };

function allowedRequest(request: Request) {
  const type = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!type.startsWith("application/json")) return false;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function underLimit(request: Request) {
  const now = Date.now();
  const key =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  for (const [candidate, value] of visitors)
    if (value.resetAt <= now) visitors.delete(candidate);
  if (!visitors.has(key) && visitors.size >= MAX_CLIENTS)
    visitors.delete(visitors.keys().next().value!);
  const value = visitors.get(key);
  if (!value || value.resetAt <= now) {
    visitors.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  value.count += 1;
  return value.count <= MAX_REPORTS;
}

export async function POST(request: Request) {
  if (!allowedRequest(request))
    return new NextResponse(null, { status: 415, headers: noStore });
  if (!underLimit(request))
    return new NextResponse(null, {
      status: 429,
      headers: { ...noStore, "retry-after": "60" },
    });
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > DIAGNOSTIC_MAX_BYTES)
    return new NextResponse(null, { status: 413, headers: noStore });
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > DIAGNOSTIC_MAX_BYTES)
      return new NextResponse(null, { status: 413, headers: noStore });
    const parsed = clientDiagnosticSchema.safeParse(JSON.parse(body));
    if (!parsed.success)
      return new NextResponse(null, { status: 400, headers: noStore });
    logClientDiagnostic(parsed.data);
    return new NextResponse(null, { status: 204, headers: noStore });
  } catch {
    return new NextResponse(null, { status: 400, headers: noStore });
  }
}
