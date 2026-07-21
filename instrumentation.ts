import { logDiagnostic } from "@/server/diagnostics";
import type { Instrumentation } from "next";

export async function register() {}

export function safeRoute(routePath: string) {
  return /^(?:\/app)?\/play\/\[characterId\](?:\/page)?$/.test(routePath)
    ? "/play/[characterId]"
    : "/other";
}

export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  logDiagnostic(
    "server",
    {
      category:
        context.routeType === "action"
          ? "server-action-failure"
          : context.routeType === "render"
            ? "render-failure"
            : "request-failure",
      route: safeRoute(context.routePath),
      method: request.method,
      router: context.routerKind,
    },
    error,
  );
};
