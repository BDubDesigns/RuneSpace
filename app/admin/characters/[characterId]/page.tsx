import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ActionLink } from "@/components/ui/ActionLink";
import { GameShell, TopBar } from "@/components/ui/GameShell";
import { AdminInspector } from "@/features/admin/AdminInspector";
import { requireAdmin } from "@/server/admin-auth";
import { loadAdminInspectorState } from "@/server/admin-state";

export const metadata = { title: "Character Inspector — Operator Console" };

/**
 * Operator inspector for one selected character (Issue #113). Server-side
 * `requireAdmin`, then loads the coherent post-reconciliation authoritative
 * snapshot plus the immutable operator audit history. The client console
 * updates the snapshot in place after each confirmed operator action.
 */
export default async function AdminCharacterInspectorPage({
  params,
}: {
  params: Promise<{ characterId: string }>;
}) {
  const admin = await requireAdmin(await headers()).catch(() => null);
  if (!admin) redirect("/sign-in");
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
          detail={`Operator ${admin.email} · owner ${inspector.owner.playerAccountId}${
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
