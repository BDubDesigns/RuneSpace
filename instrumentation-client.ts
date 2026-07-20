import { installClientDiagnostics } from "@/features/diagnostics/client";

// Next 15.5 loads this client instrumentation module for its side effect.
try {
  installClientDiagnostics();
} catch {
  /* never block application startup */
}
