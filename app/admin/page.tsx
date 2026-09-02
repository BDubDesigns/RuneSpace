import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ActionLink } from "@/components/ui/ActionLink";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { ScaffoldScreen } from "@/components/ScaffoldScreen";
import { authorizeAdminPage } from "@/server/admin-auth";

export const metadata = { title: "Operator Console — RuneSpace" };

/**
 * Admin/operator console landing (Issue #113). Server-authoritative entry:
 * the session must be a Better Auth user on the server-only admin allowlist.
 * An unauthenticated visitor is sent to `/sign-in`; an authenticated but
 * non-admin user gets the safe 403 Forbidden page (never the console, and never
 * a confusing redirect that discards their session UI).
 */
export default async function AdminHomePage() {
  const auth = await authorizeAdminPage(await headers());
  if (!auth.authorized) {
    if (auth.reason === "unauthenticated") redirect("/sign-in");
    return <AdminForbidden />;
  }
  return (
    <ScaffoldScreen>
      <div className="flex items-center justify-between">
        <SectionHeader eyebrow="Operator">Admin console</SectionHeader>
      </div>
      <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
        Signed in as{" "}
        <span className="font-medium text-[color:var(--rs-text-primary)]">{auth.admin.email}</span>.
        Repairs and test controls here are operator-scoped: they mutate only the selected character
        and write an immutable audit history.
      </p>
      <Panel as="section" className="mt-6 p-4" tone="raised">
        <ActionLink className="flex w-full" href="/admin/characters">
          Find a character
        </ActionLink>
      </Panel>
    </ScaffoldScreen>
  );
}

/** Safe 403 page for an authenticated but non-admin operator (Issue #113). */
function AdminForbidden() {
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
