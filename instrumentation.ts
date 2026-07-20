import { logDiagnostic } from "@/server/diagnostics";

export async function register() {}

export function onRequestError(
  error: unknown,
  request: { method: string },
  context: {
    routePath: string;
    routerKind: string;
    routeType: "render" | "route" | "action" | "middleware";
  },
) {
  logDiagnostic(
    "server",
    {
      category:
        context.routeType === "action"
          ? "server-action-failure"
          : context.routeType === "render"
            ? "render-failure"
            : "request-failure",
      route: context.routePath === "/play/[characterId]" ? "/play/[characterId]" : "/other",
      method: request.method,
      router: context.routerKind,
    },
    error,
  );
}
