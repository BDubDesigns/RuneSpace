import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ActionLink } from "@/components/ui/ActionLink";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { ScaffoldScreen } from "@/components/ScaffoldScreen";
import { AdminForbidden } from "@/features/admin/AdminForbidden";
import { AdminPublicGameplayPanel } from "@/features/admin/AdminPublicGameplayPanel";
import { loadPublicGameplayControlState } from "@/server/admin-access-state";
import { authorizeAdminPage } from "@/server/admin-auth";

export const metadata = { title: "Operator Console — RuneSpace" };

/**
 * Admin/operator console landing (Issue #113). Server-authoritative entry:
 * the session must be a Better Auth user on the server-only admin allowlist.
 * An unauthenticated visitor is sent to `/sign-in`; an authenticated but
 * non-admin user gets the safe 403 Forbidden page (never the console, and never
 * a confusing redirect that discards their session UI).
 *
 * Issue #223 adds the global PUBLIC GAMEPLAY panel here, separate from the
 * selected-account inspector; its state is loaded behind `requireAdmin`.
 * Issue #248 adds the Moderation panel linking the queue and access log.
 */
export default async function AdminHomePage() {
  const auth = await authorizeAdminPage(await headers());
  if (!auth.authorized) {
    if (auth.reason === "unauthenticated") redirect("/sign-in");
    return <AdminForbidden />;
  }
  const publicGameplay = await loadPublicGameplayControlState(await headers());
  return (
    <ScaffoldScreen>
      <div className="flex items-center justify-between">
        <SectionHeader eyebrow="Operator">Admin console</SectionHeader>
      </div>
      <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
        Signed in as{" "}
        <span className="font-medium text-[color:var(--rs-text-primary)]">{auth.admin.email}</span>.
        Repairs and test controls here are operator-scoped: character controls mutate only the
        selected character, access controls name their account or global scope, and every change
        writes an immutable audit history.
      </p>
      <Panel as="section" className="mt-6 p-4" tone="raised">
        <ActionLink className="flex w-full" href="/admin/characters">
          Find a character
        </ActionLink>
      </Panel>
      <Panel
        as="section"
        aria-labelledby="admin-moderation-heading"
        className="mt-4 p-4"
        tone="raised"
      >
        <h2
          className="font-display text-sm uppercase tracking-wide text-[color:var(--rs-text-muted)]"
          id="admin-moderation-heading"
        >
          Moderation
        </h2>
        <p className="mt-2 text-xs text-[color:var(--rs-text-muted)]">
          Cases, sanctions, and appeals. Every view of reports, evidence, or retained chat is
          recorded in the privileged access log.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          <ActionLink className="flex w-full" href="/admin/moderation">
            Moderation queue
          </ActionLink>
          <ActionLink
            className="flex w-full"
            href="/admin/moderation/access-log"
            intent="secondary"
          >
            Privileged access log
          </ActionLink>
        </div>
      </Panel>
      <AdminPublicGameplayPanel initial={publicGameplay} />
    </ScaffoldScreen>
  );
}
