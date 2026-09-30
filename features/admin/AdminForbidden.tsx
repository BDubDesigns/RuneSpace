import { ScaffoldScreen } from "@/components/ScaffoldScreen";
import { SectionHeader } from "@/components/ui/SectionHeader";

/**
 * Safe 403 page for an authenticated but non-admin operator (Issue #113),
 * shared by the console home and every moderation page (issue #248).
 */
export function AdminForbidden() {
  return (
    <ScaffoldScreen>
      <div className="flex items-center justify-between">
        <SectionHeader eyebrow="Forbidden">403 · Operator console</SectionHeader>
      </div>
      <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
        Your session is authenticated, but your account is not on the admin allowlist, so this
        console is not available to you.
      </p>
    </ScaffoldScreen>
  );
}
