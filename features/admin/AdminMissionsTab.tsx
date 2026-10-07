"use client";

import { adminResetAllMissions, adminResetMissionChain } from "@/server/admin-actions";
import type { AdminInspectorState, AdminMissionDetail } from "@/server/admin-state";
import { ConfirmAction } from "./ConfirmAction";
import { missionStateLabel } from "./admin-format";
import { listItemClass, Section, type AdminTabProps } from "./AdminParts";

/**
 * Missions tab (#333): the authored-mission records (title, id, prerequisite,
 * status, timestamps) and the reset controls that act on them, together.
 */

function MissionRecords({ missions }: { missions: readonly AdminMissionDetail[] }) {
  if (missions.length === 0) {
    return <p className="text-sm text-[color:var(--rs-text-muted)]">No authored missions.</p>;
  }
  return (
    <ul className="space-y-2 text-sm">
      {missions.map((mission) => (
        <li
          key={mission.missionId}
          className="rounded border border-[color:var(--rs-border-structural)] p-2"
        >
          <div className="flex flex-wrap items-center gap-x-2">
            <span className="font-medium">{mission.title}</span>
            <span className="text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
              {mission.missionId}
            </span>
            <span
              className={`rounded px-1.5 text-xs uppercase ${
                mission.status === "completed"
                  ? "bg-green-900/30 text-green-300"
                  : mission.status === "accepted"
                    ? "bg-amber-900/30 text-amber-300"
                    : "bg-slate-800/40 text-[color:var(--rs-text-muted)]"
              }${mission.stale ? "ring-1 ring-yellow-800/60" : ""}`}
            >
              {mission.stale ? "stale" : mission.status}
            </span>
          </div>
          <div className="mt-1 text-xs text-[color:var(--rs-text-muted)]">
            {mission.prerequisiteMissionId ? `Requires ${mission.prerequisiteMissionId} · ` : ""}
            {mission.status === "not_accepted"
              ? "not accepted"
              : `accepted ${mission.acceptedAt ?? "—"}`}
            {mission.completedAt ? ` · completed ${mission.completedAt}` : ""}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function AdminMissionsTab({
  state,
  ...props
}: AdminTabProps & { state: AdminInspectorState }) {
  const { characterId, characterName, play, applyState, refreshAll, bus } = props;

  async function resetChain(missionId: string) {
    const response = await adminResetMissionChain({ characterId, missionId });
    if ("error" in response) return bus(response.error, "danger");
    if (response.outcome.kind === "reset") {
      applyState(response.state);
      await refreshAll();
      bus(`Reset ${response.outcome.deleted} mission row(s) from this chain.`, "success");
    } else {
      applyState(response.state);
      bus("Nothing to reset in this chain.", "muted");
    }
  }

  async function resetAll() {
    const response = await adminResetAllMissions({ characterId });
    if ("error" in response) return bus(response.error, "danger");
    if (response.outcome.kind === "reset") {
      applyState(response.state);
      await refreshAll();
      bus(`Reset all missions for this character (${response.outcome.deleted} row(s)).`, "success");
    } else {
      applyState(response.state);
      bus("No missions recorded for this character.", "muted");
    }
  }

  return (
    <div className="space-y-4">
      <Section title="Mission records">
        <MissionRecords missions={state.missions} />
      </Section>

      <Section title="Mission resets">
        <p className="text-xs text-[color:var(--rs-text-muted)]">
          RESET FROM THIS MISSION also clears its transitive chain. RESET ALL is scoped to this
          character only — never the whole population.
        </p>
        <ConfirmAction
          label="RESET ALL missions (this character)"
          confirmLabel="Confirm reset all"
          fullWidth
          prompt={`Reset ALL currently-authored mission records for "${characterName}" (they will need to be re-accepted).`}
          onConfirm={resetAll}
        />
        {/* Per-mission chain reset is driven from the server-derived mission
            projections on the selected character — never a hardcoded mission id
            (issue #124 guardrail: no mission-ID branches in feature components). */}
        {play.missions.length === 0 ? (
          <p className="text-sm text-[color:var(--rs-text-muted)]">
            No missions present for this character to reset from.
          </p>
        ) : (
          <ul className="space-y-2">
            {play.missions.map((mission) => (
              <li
                key={mission.missionId}
                className={`flex flex-wrap items-center justify-between gap-2 ${listItemClass}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="text-[color:var(--rs-text-primary)]">{mission.title}</span>
                  <span className="ml-2 text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
                    {missionStateLabel(mission.state)}
                  </span>
                </span>
                <ConfirmAction
                  label="Reset from here"
                  confirmLabel="Confirm reset chain"
                  prompt={`Reset the mission chain rooted at "${mission.title}" (${mission.missionId}) for "${characterName}".`}
                  onConfirm={() => resetChain(mission.missionId)}
                />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
