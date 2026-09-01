import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ActionLink } from "@/components/ui/ActionLink";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { ScaffoldScreen } from "@/components/ScaffoldScreen";
import { requireAdmin } from "@/server/admin-auth";

export const metadata = { title: "Operator Console — RuneSpace" };

/**
 * Admin/operator console landing (Issue #113). Server-authoritative entry:
 * the session must be a Better Auth user on the server-only admin allowlist.
 * Ordinary authenticated users are redirected away; the page is never a public
 * affordance in player navigation.
 */
export default async function AdminHomePage() {
  const session = await requireAdmin(await headers()).catch(() => null);
  if (!session) redirect("/sign-in");
  return (
    <ScaffoldScreen>
      <div className="flex items-center justify-between">
        <SectionHeader eyebrow="Operator">Admin console</SectionHeader>
      </div>
      <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
        Signed in as{" "}
        <span className="font-medium text-[color:var(--rs-text-primary)]">{session.email}</span>.
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
