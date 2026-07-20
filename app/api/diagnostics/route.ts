import { NextResponse } from "next/server";
import { DIAGNOSTIC_MAX_BYTES, clientDiagnosticSchema } from "@/game/schemas/diagnostics";
import { logClientDiagnostic } from "@/server/diagnostics";

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > DIAGNOSTIC_MAX_BYTES) return new NextResponse(null, { status: 413 });
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > DIAGNOSTIC_MAX_BYTES)
    return new NextResponse(null, { status: 413 });
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const parsed = clientDiagnosticSchema.safeParse(payload);
  if (!parsed.success) return new NextResponse(null, { status: 400 });
  logClientDiagnostic(parsed.data);
  return new NextResponse(null, { status: 204 });
}
