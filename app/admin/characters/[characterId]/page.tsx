import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ActionLink } from "@/components/ui/ActionLink";
import { GameShell, TopBar } from "@/components/ui/GameShell";
import { AdminInspector } from "@/features/admin/AdminInspector";
import { authorizeAdminPage } from "@/server/admin-auth";
import { loadAdminInspectorState } from "@/server/admin-state";

export const metadata = { title: "Character Inspector — Operator Console" };

/**
 * Operator inspector for one selected character (Issue #113). Server-side
 * `authorizeAdminPage` (an authenticated non-admin gets a safe 403 page), then
 * loads the coherent post-reconciliation authoritative snapshot plus the
 * immutable operator audit history.
 */
export default async function AdminCharacterInspectorPage({
  params,
}: {
  params: Promise<{ characterId: string }>;
}) {
  const auth = await authorizeAdminPage(await headers());
  if (!auth.authorized) {
    if (auth.reason === "unauthenticated") redirect("/sign-in");
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
  const { characterId } = await params;
  const inspector = await loadAdminInspectorState(await headers(), characterId).catch(() => null);
  if (!inspector) {
    return (
      <GameShell
        topBar={
          <TopBar
            title="Character not found"
            detail="The selected character no longer resolves to authoritative state."
            trailing={
              <ActionLink href="/admin/characters" intent="secondary" className="px-3 py-1 text-xs">
                Back to search
              </ActionLink>
            }
          />
        }
      >
        <p className="text-sm text-[color:var(--rs-text-muted)]">
          Return to character search to pick another character.
        </p>
      </GameShell>
    );
  }
  return (
    <GameShell
      topBar={
        <TopBar
          title={inspector.characterId}
          detail={`Operator ${auth.admin.email} · owner ${inspector.owner.playerAccountId}${
            inspector.owner.maskedEmail ? ` (${inspector.owner.maskedEmail})` : ""
          }`}
          trailing={
            <ActionLink href="/admin/characters" intent="secondary" className="px-3 py-1 text-xs">
              Back to search
            </ActionLink>
          }
        />
      }
    >
      <AdminInspector initial={inspector} />
    </GameShell>
  );
}
