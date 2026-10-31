// Coolify runs this inside the application container; never put secrets in its command.
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--dry-run")) {
  console.error("Usage: node server/scapelikes-presence-task.mjs [--dry-run]");
  process.exitCode = 1;
} else {
  const secret = process.env.SCAPELIKES_PRESENCE_CRON_SECRET?.trim();
  const port = process.env.PORT || "3000";
  if (
    !secret ||
    secret.length < 32 ||
    !/^[0-9]+$/.test(port) ||
    Number(port) < 1 ||
    Number(port) > 65535
  ) {
    console.error("[scapelikes-presence-task] Invalid or missing configuration.");
    process.exitCode = 1;
  } else {
    const dryRun = args[0] === "--dry-run";
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/api/integrations/scapelikes-presence${dryRun ? "?dry_run=1" : ""}`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${secret}` },
          signal: AbortSignal.timeout(8_000),
          redirect: "error",
        },
      );
      if (!response.ok) {
        console.error(`[scapelikes-presence-task] Route returned HTTP ${response.status}.`);
        process.exitCode = 1;
      } else {
        console.log(`[scapelikes-presence-task] ${dryRun ? "Dry-run validated" : "Report sent"}.`);
      }
    } catch {
      console.error("[scapelikes-presence-task] Route request failed.");
      process.exitCode = 1;
    }
  }
}
