import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ActionLink } from "@/components/ui/ActionLink";
import { GameShell, TopBar } from "@/components/ui/GameShell";
import { AdminSearch } from "@/features/admin/AdminSearch";
import { authorizeAdminPage } from "@/server/admin-auth";

export const metadata = { title: "Find Character — Operator Console" };

/**
 * Character search for the operator console (Issue #113). Server-authoritative,
 * then a client search box queries the authorized read boundary
 * (`searchCharactersAdmin`). Results expose only narrow owner disambiguation
 * (account id + masked email), never secrets or session data. An authenticated
 * non-admin gets the safe 403 page rather than a sign-in redirect.
 */
export default async function AdminCharactersSearchPage() {
  const auth = await authorizeAdminPage(await headers());
  if (!auth.authorized) {
    if (auth.reason === "unauthenticated") redirect("/sign-in");
    return <AdminForbidden />;
  }
  return (
    <GameShell
      topBar={
        <TopBar
          title="Find a character"
          detail={`Operator ${auth.admin.email} · search matches a character name or normalized name`}
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

/** Safe 403 page for an authenticated but non-admin operator (Issue #113). */
function AdminForbidden() {
  return (
    <GameShell
      topBar={
        <TopBar
          title="Forbidden"
          detail="403 · Operator console"
          trailing={
            <ActionLink href="/" intent="secondary" className="px-3 py-1 text-xs">
              Exit
            </ActionLink>
          }
        />
      }
    >
      <p className="text-sm text-[color:var(--rs-text-muted)]">
        Your session is authenticated, but your account is not on the admin allowlist, so this
        console is not available to you.
      </p>
    </GameShell>
  );
}
