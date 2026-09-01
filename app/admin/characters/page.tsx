import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ActionLink } from "@/components/ui/ActionLink";
import { GameShell, TopBar } from "@/components/ui/GameShell";
import { AdminSearch } from "@/features/admin/AdminSearch";
import { requireAdmin } from "@/server/admin-auth";

export const metadata = { title: "Find Character — Operator Console" };

/**
 * Character search for the operator console (Issue #113). Server-authoritative,
 * then a client search box queries the authorized read boundary
 * (`searchCharactersAdmin`). Results expose only narrow owner disambiguation
 * (account id + masked email), never secrets or session data.
 */
export default async function AdminCharactersSearchPage() {
  const admin = await requireAdmin(await headers()).catch(() => null);
  if (!admin) redirect("/sign-in");
  return (
    <GameShell
      topBar={
        <TopBar
          title="Find a character"
          detail={`Operator ${admin.email} · search matches a character name or normalized name`}
          trailing={
            <ActionLink href="/admin" intent="secondary" className="px-3 py-1 text-xs">
              Exit
            </ActionLink>
          }
        />
      }
    >
      <AdminSearch />
    </GameShell>
  );
}
