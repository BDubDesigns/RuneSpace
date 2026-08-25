"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import {
  createBlankDraft,
  createBeatForSubject,
  createDraftFromAdapterSequence,
  cloneDraft,
} from "../../core/draft";
import { createDialogueExportPayload } from "../../core/export";
import {
  createSnapshotHistory,
  pushSnapshot,
  redoSnapshot,
  undoSnapshot,
  type SnapshotHistory,
} from "../../core/history";
import {
  addDurableCheckpoint,
  getDialogueStudioStorageKey,
  getLegacyDialogueStudioStorageKey,
  parsePersistedDialogueStudio,
  serializeDialogueStudio,
} from "../../core/storage";
import { getStudioItemQuantityRange, validateDialogueDraft } from "../../core/validation";
import type {
  DialogueAdapter,
  DialogueCheckpoint,
  DialogueDraft,
  StudioDialogueBeat,
  StudioDialoguePresentationMode,
} from "../../core/types";

export type DialoguePreviewProps = {
  beat: StudioDialogueBeat;
  visibleText: string;
  fullText: string;
  isComplete: boolean;
  onTextClick: () => void;
  portraitGeneration: number;
  actionMessage?: string;
  controls?: ReactNode;
};

export type DialoguePreviewRenderer = (props: DialoguePreviewProps) => ReactNode;

const CONTROL_CLASS =
  "rs-bevel rs-focus min-h-[var(--rs-control-height)] w-full border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-control)] px-3 text-sm text-[color:var(--rs-text-primary)]";
const TEXTAREA_CLASS =
  "rs-bevel rs-focus min-h-40 w-full resize-y border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-control)] p-3 text-sm leading-relaxed text-[color:var(--rs-text-primary)] placeholder:text-[color:var(--rs-text-muted)]";

function createClientId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatSavedState(savedAt: string | undefined): string {
  if (!savedAt) return "Saved";
  return `Saved ${new Date(savedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

export function DialogueStudio({
  adapter,
  renderPreview,
}: {
  adapter: DialogueAdapter;
  renderPreview: DialoguePreviewRenderer;
}) {
  const firstSequence = adapter.sequences[0];
  const initialDraft = firstSequence
    ? createDraftFromAdapterSequence(adapter, firstSequence, createClientId("studio-draft"))
    : createBlankDraft(adapter, createClientId("studio-draft"));
  const [history, setHistory] = useState<SnapshotHistory<DialogueDraft>>(() =>
    createSnapshotHistory(initialDraft),
  );
  const [checkpoints, setCheckpoints] = useState<DialogueCheckpoint[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "unsaved">("saved");
  const [savedAt, setSavedAt] = useState<string>();
  const [storageMessage, setStorageMessage] = useState<string>();
  const [sourceSelection, setSourceSelection] = useState(firstSequence?.id ?? "");
  const [selectedBeatIndex, setSelectedBeatIndex] = useState(0);
  const [previewBeatIndex, setPreviewBeatIndex] = useState(0);
  const [revealedChars, setRevealedChars] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [previewActioned, setPreviewActioned] = useState(false);
  const [exportText, setExportText] = useState<string>();
  const [copyMessage, setCopyMessage] = useState<string>();
  const historyRef = useRef(history);
  const textHistoryBase = useRef<DialogueDraft | null>(null);
  const textHistoryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const storageWriteBlocked = useRef(false);
  const changeKind = useRef<"text" | "structural" | "idle">("idle");
  const beatButtonRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const [storageKey, legacyStorageKey] = [
    getDialogueStudioStorageKey(adapter.adapterId),
    getLegacyDialogueStudioStorageKey(adapter.adapterId),
  ];

  const draft = history.present;
  const selectedBeat = draft.beats[selectedBeatIndex];
  const previewBeat = draft.beats[previewBeatIndex];
  const previewIsLastBeat = previewBeatIndex === draft.beats.length - 1;
  const validation = useMemo(() => validateDialogueDraft(adapter, draft), [adapter, draft]);
  const selectedNpc =
    selectedBeat && selectedBeat.kind === "npc"
      ? adapter.npcs.find((npc) => npc.id === selectedBeat.speakerNpcId)
      : undefined;
  const selectedBeatItem =
    selectedBeat && selectedBeat.kind === "item"
      ? adapter.items?.find((item) => item.id === selectedBeat.itemId)
      : undefined;
  // Falls back to a harmless 1..1 range when the item itself is invalid;
  // the validation issue surfaces the real problem.
  const selectedQuantityRange = selectedBeatItem
    ? getStudioItemQuantityRange(selectedBeatItem)
    : { min: 1, max: 1 };
  const sourceSequence = draft.sourceSequenceId
    ? adapter.sequences.find((sequence) => sequence.id === draft.sourceSequenceId)
    : undefined;
  const previewIssues = validation.issues.filter(
    (issue) =>
      issue.path === `beats.${previewBeatIndex}` ||
      issue.path.startsWith(`beats.${previewBeatIndex}.`),
  );

  const writeState = useCallback(
    (nextDraft: DialogueDraft, nextCheckpoints: readonly DialogueCheckpoint[]) => {
      if (storageWriteBlocked.current) {
        setSaveState("unsaved");
        return false;
      }
      try {
        window.localStorage.setItem(
          storageKey,
          serializeDialogueStudio(nextDraft, nextCheckpoints),
        );
        setSaveState("saved");
        const nextSavedAt = new Date().toISOString();
        setSavedAt(nextSavedAt);
        changeKind.current = "idle";
        return true;
      } catch {
        setSaveState("unsaved");
        setStorageMessage("Local draft storage is unavailable; use Export to preserve this work.");
        return false;
      }
    },
    [storageKey],
  );

  useEffect(() => {
    storageWriteBlocked.current = false;
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        // Schema v1 drafts lived under the legacy key; adopt and upgrade them
        // in place so existing local work is not silently stranded.
        const legacyRaw = window.localStorage.getItem(legacyStorageKey);
        if (legacyRaw) raw = legacyRaw;
      }
    } catch {
      setStorageMessage("Local draft storage is unavailable; use Export to preserve this work.");
    }
    const stored = parsePersistedDialogueStudio(raw, adapter.adapterId);
    if (stored.kind === "loaded" || stored.kind === "migrated") {
      const nextHistory = createSnapshotHistory(stored.state.draft);
      historyRef.current = nextHistory;
      setHistory(nextHistory);
      setCheckpoints(stored.state.checkpoints);
      setSourceSelection(stored.state.draft.sourceSequenceId ?? "");
      setStorageMessage(
        stored.kind === "migrated"
          ? "Upgraded the saved v1 draft to the current format with item-beat support."
          : "Recovered the last local QC Studio draft.",
      );
      if (stored.kind === "migrated") {
        try {
          // Persist the upgraded payload immediately; leave the legacy entry in
          // place as a belt-and-braces backup until the next successful save.
          window.localStorage.setItem(
            storageKey,
            serializeDialogueStudio(stored.state.draft, stored.state.checkpoints),
          );
        } catch {
          /* keep the in-memory migrated state; autosave will retry */
        }
      }
    } else if (stored.kind === "unsupported") {
      storageWriteBlocked.current = true;
      setStorageMessage(
        "A newer saved draft format was found; it was left untouched. Export new work to preserve it.",
      );
    } else if (stored.kind === "invalid") {
      setStorageMessage("The saved draft could not be read safely; a fresh draft is ready.");
    }
    setHydrated(true);
  }, [adapter.adapterId, storageKey]);

  useEffect(() => {
    if (!hydrated) return;
    if (storageWriteBlocked.current) {
      setSaveState("unsaved");
      return;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState("saving");
    const delay = changeKind.current === "structural" ? 0 : 900;
    saveTimer.current = setTimeout(() => writeState(draft, checkpoints), delay);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [checkpoints, draft, hydrated, writeState]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (draft.beats.length === 0) return;
    const nextIndex = Math.min(selectedBeatIndex, draft.beats.length - 1);
    if (nextIndex !== selectedBeatIndex) setSelectedBeatIndex(nextIndex);
    const nextPreviewIndex = Math.min(previewBeatIndex, draft.beats.length - 1);
    if (nextPreviewIndex !== previewBeatIndex) setPreviewBeatIndex(nextPreviewIndex);
  }, [draft.beats.length, previewBeatIndex, selectedBeatIndex]);

  useEffect(() => {
    beatButtonRefs.current[selectedBeatIndex]?.focus();
  }, [selectedBeatIndex]);

  useEffect(() => {
    if (!previewBeat) return;
    const length = Array.from(previewBeat.text).length;
    if (reducedMotion) {
      setRevealedChars(length);
      return;
    }
    if (revealedChars >= length) return;
    const timer = window.setTimeout(
      () => setRevealedChars((current) => Math.min(length, current + 1)),
      20,
    );
    return () => window.clearTimeout(timer);
  }, [previewBeat, reducedMotion, revealedChars]);

  useEffect(() => {
    return () => {
      if (textHistoryTimer.current) clearTimeout(textHistoryTimer.current);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  function flushTextHistory() {
    if (textHistoryTimer.current) {
      clearTimeout(textHistoryTimer.current);
      textHistoryTimer.current = null;
    }
    if (changeKind.current !== "text") return historyRef.current;
    const current = historyRef.current;
    const baseline = textHistoryBase.current;
    if (!baseline) return current;
    const next = pushSnapshot(
      { past: current.past, present: baseline, future: [] },
      cloneDraft(current.present),
    );
    textHistoryBase.current = null;
    historyRef.current = next;
    setHistory(next);
    changeKind.current = "structural";
    return next;
  }

  function updateTextDraft(mutator: (draft: DialogueDraft) => DialogueDraft) {
    const current = historyRef.current;
    if (changeKind.current !== "text") {
      textHistoryBase.current = cloneDraft(current.present);
    }
    const next: SnapshotHistory<DialogueDraft> = {
      past: current.past,
      present: mutator(cloneDraft(current.present)),
      future: [],
    };
    historyRef.current = next;
    setHistory(next);
    changeKind.current = "text";
    if (textHistoryTimer.current) clearTimeout(textHistoryTimer.current);
    textHistoryTimer.current = setTimeout(() => flushTextHistory(), 800);
  }

  function applyStructural(mutator: (draft: DialogueDraft) => DialogueDraft) {
    flushTextHistory();
    const current = historyRef.current;
    const next = pushSnapshot(current, mutator(cloneDraft(current.present)));
    historyRef.current = next;
    setHistory(next);
    changeKind.current = "structural";
  }

  function replaceDraft(nextDraft: DialogueDraft) {
    if (textHistoryTimer.current) clearTimeout(textHistoryTimer.current);
    textHistoryBase.current = null;
    const next = createSnapshotHistory(cloneDraft(nextDraft));
    historyRef.current = next;
    setHistory(next);
    setSelectedBeatIndex(0);
    setPreviewBeatIndex(0);
    setRevealedChars(0);
    setPreviewActioned(false);
    changeKind.current = "structural";
  }

  function checkpointCurrent(label: string) {
    const currentHistory = flushTextHistory();
    const nextCheckpoints = addDurableCheckpoint(
      checkpoints,
      currentHistory.present,
      label,
      new Date().toISOString(),
      createClientId("checkpoint"),
    );
    setCheckpoints(nextCheckpoints);
    return writeState(currentHistory.present, nextCheckpoints);
  }

  function loadSelectedSource() {
    const sequence = adapter.sequences.find((candidate) => candidate.id === sourceSelection);
    if (!sequence) return;
    checkpointCurrent(`Before loading ${sequence.title}`);
    replaceDraft(createDraftFromAdapterSequence(adapter, sequence, createClientId("studio-draft")));
  }

  function createNewDraft() {
    checkpointCurrent("Before creating a new draft");
    replaceDraft(createBlankDraft(adapter, createClientId("studio-draft")));
    setSourceSelection("");
  }

  function saveCheckpoint() {
    const saved = checkpointCurrent("Manual Save");
    setCopyMessage(
      saved
        ? "Saved a durable checkpoint locally."
        : "The checkpoint is available for this session only; the saved draft format was left untouched.",
    );
  }

  function resetToSource() {
    if (
      !sourceSequence ||
      !window.confirm("Reset this draft to its authoritative source version?")
    ) {
      return;
    }
    checkpointCurrent("Before Reset to Source");
    replaceDraft(
      createDraftFromAdapterSequence(adapter, sourceSequence, draft.draftId, sourceSequence.title),
    );
  }

  function restoreCheckpoint(checkpoint: DialogueCheckpoint) {
    checkpointCurrent(`Before restoring ${checkpoint.label}`);
    replaceDraft(cloneDraft(checkpoint.draft));
    setSourceSelection(checkpoint.draft.sourceSequenceId ?? "");
    setCopyMessage(`Restored ${checkpoint.label}. The pre-restore draft was checkpointed.`);
  }

  function undo() {
    const current = flushTextHistory();
    if (current.past.length === 0) return;
    const next = undoSnapshot(current);
    historyRef.current = next;
    setHistory(next);
    changeKind.current = "structural";
  }

  function redo() {
    const current = flushTextHistory();
    if (current.future.length === 0) return;
    const next = redoSnapshot(current);
    historyRef.current = next;
    setHistory(next);
    changeKind.current = "structural";
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  type NpcBeatPatch = Partial<Omit<Extract<StudioDialogueBeat, { kind: "npc" }>, "kind">>;
  type ItemBeatPatch = Partial<Omit<Extract<StudioDialogueBeat, { kind: "item" }>, "kind">>;

  /**
   * Patch only the fields of the beat's ACTIVE kind. The switch below keeps
   * the two shapes disjoint, so a patch can never write an item field into an
   * NPC beat or vice versa.
   */
  function updateBeat(index: number, update: NpcBeatPatch | ItemBeatPatch) {
    applyStructural((current) => ({
      ...current,
      npcId:
        index === 0 && "speakerNpcId" in update && update.speakerNpcId
          ? update.speakerNpcId
          : current.npcId,
      beats: current.beats.map((beat, beatIndex) => {
        if (beatIndex !== index) return beat;
        if (beat.kind === "npc") {
          return { ...beat, ...(update as NpcBeatPatch), kind: "npc" as const };
        }
        return { ...beat, ...(update as ItemBeatPatch), kind: "item" as const };
      }),
    }));
  }

  /**
   * Replaces the beat wholesale with the target subject's shape. Subject
   * switching must never merge with the previous shape — stale NPC fields
   * could otherwise survive on item beats and stale item fields on NPC beats.
   */
  function switchSubject(index: number, kind: "npc" | "item") {
    const current = historyRef.current.present.beats[index];
    if (!current || current.kind === kind) return;
    flushTextHistory();
    const backgroundId = current.backgroundId || adapter.backgrounds[0]?.id || "";
    applyStructural((draftToUpdate) => ({
      ...draftToUpdate,
      beats: draftToUpdate.beats.map((beat, beatIndex) => {
        if (beatIndex !== index) return beat;
        return createBeatForSubject(adapter, kind, backgroundId);
      }),
    }));
  }

  function selectItem(index: number, itemId: string) {
    const selected = adapter.items?.find((candidate) => candidate.id === itemId);
    if (!selected) return;
    // Re-clamp quantity into the newly selected item's authoritative range.
    const { max } = getStudioItemQuantityRange(selected);
    const previous = draft.beats[index];
    const previousQuantity =
      previous && previous.kind === "item" ? Math.min(previous.quantity, max) : 1;
    updateBeat(index, { itemId, quantity: Math.max(1, previousQuantity) });
  }

  function setItemQuantity(index: number, rawValue: number) {
    const beat = draft.beats[index];
    if (!beat || beat.kind !== "item") return;
    const selected = adapter.items?.find((candidate) => candidate.id === beat.itemId);
    if (!selected) return;
    const { min, max } = getStudioItemQuantityRange(selected);
    if (!Number.isInteger(rawValue)) return;
    updateBeat(index, { quantity: Math.max(min, Math.min(max, rawValue)) });
  }

  function addBeat(duplicate: boolean) {
    const current = historyRef.current.present;
    const source = current.beats[selectedBeatIndex] ?? current.beats[0];
    if (!source) return;
    const newBeat = duplicate ? { ...source } : { ...source, text: "" };
    applyStructural((draftToUpdate) => ({
      ...draftToUpdate,
      beats: [
        ...draftToUpdate.beats.slice(0, selectedBeatIndex + 1),
        newBeat,
        ...draftToUpdate.beats.slice(selectedBeatIndex + 1),
      ],
    }));
    setSelectedBeatIndex(selectedBeatIndex + 1);
    setPreviewBeatIndex(selectedBeatIndex + 1);
    setRevealedChars(duplicate ? Array.from(newBeat.text).length : 0);
  }

  function deleteBeat() {
    if (draft.beats.length <= 1) return;
    applyStructural((current) => ({
      ...current,
      beats: current.beats.filter((_, index) => index !== selectedBeatIndex),
    }));
    setSelectedBeatIndex(Math.max(0, Math.min(selectedBeatIndex, draft.beats.length - 2)));
  }

  function moveBeat(direction: -1 | 1) {
    const target = selectedBeatIndex + direction;
    if (target < 0 || target >= draft.beats.length) return;
    applyStructural((current) => {
      const beats = [...current.beats];
      const [moved] = beats.splice(selectedBeatIndex, 1);
      if (!moved) return current;
      beats.splice(target, 0, moved);
      return { ...current, beats };
    });
    setSelectedBeatIndex(target);
    if (previewBeatIndex === selectedBeatIndex) setPreviewBeatIndex(target);
  }

  function inspectBeat(index: number) {
    const beat = draft.beats[index];
    setSelectedBeatIndex(index);
    setPreviewBeatIndex(index);
    setPreviewActioned(false);
    setRevealedChars(beat ? Array.from(beat.text).length : 0);
  }

  function startPlayback() {
    setPreviewBeatIndex(0);
    setSelectedBeatIndex(0);
    setPreviewActioned(false);
    setRevealedChars(0);
  }

  function previewBack() {
    if (previewBeatIndex === 0) return;
    const next = previewBeatIndex - 1;
    setPreviewBeatIndex(next);
    setSelectedBeatIndex(next);
    setPreviewActioned(false);
    setRevealedChars(Array.from(draft.beats[next]?.text ?? "").length);
  }

  function previewNext() {
    if (!previewBeat) return;
    const length = Array.from(previewBeat.text).length;
    if (revealedChars < length) {
      setRevealedChars(length);
      return;
    }
    if (previewIsLastBeat) {
      setCopyMessage("Preview finished — no gameplay action was run.");
      return;
    }
    const next = previewBeatIndex + 1;
    setPreviewBeatIndex(next);
    setSelectedBeatIndex(next);
    setRevealedChars(0);
  }

  async function copyForRuneSpace() {
    if (!validation.valid) {
      setCopyMessage("Fix the validation issues before exporting.");
      return;
    }
    const payload = createDialogueExportPayload(adapter.adapterId, draft);
    const serialized = JSON.stringify(payload, null, 2);
    setExportText(serialized);
    try {
      await navigator.clipboard.writeText(serialized);
      setCopyMessage("Copied the structured draft. It is not published automatically.");
    } catch {
      setCopyMessage("The structured draft is ready below; clipboard access was unavailable.");
    }
  }

  const previewControls = previewBeat ? (
    <>
      <ActionButton
        aria-label="Restart preview"
        className="px-3"
        intent="secondary"
        onClick={startPlayback}
      >
        ↻ <span className="sr-only">Restart preview</span>
      </ActionButton>
      <div className="flex flex-wrap justify-end gap-2">
        <ActionButton disabled={previewBeatIndex === 0} intent="secondary" onClick={previewBack}>
          Back
        </ActionButton>
        {draft.action &&
        previewIsLastBeat &&
        revealedChars >= Array.from(previewBeat.text).length ? (
          <ActionButton
            data-dialogue-action
            data-qc-studio-preview-action
            intent="primary"
            onClick={() => setPreviewActioned(true)}
          >
            {previewActioned
              ? "Action previewed"
              : draft.action === "accept_mission"
                ? "Accept mission"
                : "Complete mission"}
          </ActionButton>
        ) : (
          <ActionButton data-dialogue-next intent="primary" onClick={previewNext}>
            {previewIsLastBeat ? "Finish" : "Next"}
          </ActionButton>
        )}
      </div>
    </>
  ) : null;

  const selectedBeatIssue = (suffix: string) =>
    validation.issues.find((issue) => issue.path === `beats.${selectedBeatIndex}.${suffix}`)
      ?.message;

  return (
    <main className="min-h-screen bg-[color:var(--rs-surface-page)] px-4 py-5 text-[color:var(--rs-text-primary)] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1500px]">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[color:var(--rs-border-structural)] pb-5">
          <div>
            <p className="font-display text-xs uppercase tracking-[0.2em] text-[color:var(--rs-accent-primary)]">
              QC STUDIO
            </p>
            <SectionHeader eyebrow="Dialogue module">Visual authoring environment</SectionHeader>
            <p className="mt-2 max-w-2xl text-sm text-[color:var(--rs-text-secondary)]">
              Author a local draft with the real {adapter.displayName} conversation presentation.
            </p>
          </div>
          <div className="text-right text-xs uppercase tracking-[0.14em] text-[color:var(--rs-text-muted)]">
            <p>Project adapter: {adapter.displayName}</p>
            <p className="mt-1" data-qc-studio-save-state>
              {saveState === "saving"
                ? "Saving…"
                : saveState === "unsaved"
                  ? "Unsaved changes…"
                  : formatSavedState(savedAt)}
            </p>
          </div>
        </header>

        {storageMessage ? <Feedback tone="muted">{storageMessage}</Feedback> : null}
        {copyMessage ? (
          <Feedback tone={copyMessage.includes("Fix") ? "danger" : "success"}>
            {copyMessage}
          </Feedback>
        ) : null}

        <div className="mt-5 grid gap-5 lg:grid-cols-12">
          <Panel as="section" className="min-w-0 !p-4 lg:col-span-3" data-qc-studio-sequence-panel>
            <p className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-primary)]">
              Sequence / beats
            </p>
            <label
              className="mt-4 block text-sm text-[color:var(--rs-text-secondary)]"
              htmlFor="qc-source-sequence"
            >
              Load authoritative sequence
              <select
                className={`${CONTROL_CLASS} mt-2`}
                id="qc-source-sequence"
                onChange={(event) => setSourceSelection(event.target.value)}
                value={sourceSelection}
              >
                <option value="">Choose a source…</option>
                {adapter.sequences.map((sequence) => (
                  <option key={sequence.id} value={sequence.id}>
                    {sequence.title}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-3 grid gap-2">
              <ActionButton
                data-qc-studio-load-source
                intent="secondary"
                onClick={loadSelectedSource}
              >
                Load source as draft
              </ActionButton>
              <ActionButton data-qc-studio-new-draft intent="secondary" onClick={createNewDraft}>
                New blank draft
              </ActionButton>
            </div>
            <div className="mt-5 border-t border-[color:var(--rs-border-subtle)] pt-4">
              <p className="truncate text-sm font-semibold" title={draft.title}>
                {draft.title || "Untitled draft"}
              </p>
              <p className="mt-1 text-xs text-[color:var(--rs-text-muted)]">
                {sourceSequence ? `Source: ${sourceSequence.title}` : "Unsourced temporary draft"}
              </p>
            </div>
            <ol className="mt-4 space-y-2" aria-label="Dialogue beats">
              {draft.beats.map((beat, index) => {
                const isSelected = index === selectedBeatIndex;
                const beatLabel =
                  beat.kind === "item"
                    ? `${
                        adapter.items?.find((candidate) => candidate.id === beat.itemId)
                          ?.displayName ?? "Unknown item"
                      }${beat.quantity > 1 ? ` ×${beat.quantity}` : ""}`
                    : (adapter.npcs.find((candidate) => candidate.id === beat.speakerNpcId)
                        ?.displayName ?? "Unknown speaker");
                return (
                  <li key={`${index}-${beat.kind}`}>
                    <button
                      ref={(element) => {
                        beatButtonRefs.current[index] = element;
                      }}
                      aria-current={isSelected ? "true" : undefined}
                      className={`rs-focus flex w-full items-start gap-2 border p-2 text-left text-sm ${
                        isSelected
                          ? "border-[color:var(--rs-accent-primary)] bg-[color:var(--rs-accent-primary-subtle)]"
                          : "border-[color:var(--rs-border-subtle)] bg-[color:var(--rs-surface-panel)]"
                      }`}
                      data-qc-studio-beat={index}
                      onClick={() => inspectBeat(index)}
                      type="button"
                    >
                      <span
                        className="w-7 shrink-0 pt-0.5 font-display text-xs uppercase tracking-[0.12em] text-[color:var(--rs-accent-primary)]"
                        data-qc-studio-beat-number
                      >
                        B{index + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{beatLabel}</span>
                        <span className="mt-0.5 block truncate text-xs text-[color:var(--rs-text-muted)]">
                          {beat.text || (beat.kind === "item" ? "Item reveal" : "Empty text")}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </Panel>

          <div
            className="grid min-w-0 gap-5 lg:col-span-9 xl:grid-cols-12 xl:items-start"
            data-qc-studio-preview-layout
          >
            <Panel
              as="section"
              className="w-full min-w-0 max-w-4xl sm:!p-5 xl:col-span-8"
              data-qc-studio-preview-panel
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-primary)]">
                    Actual rendered preview
                  </p>
                  <h2 className="mt-1 font-display text-lg font-bold">
                    {previewBeat
                      ? `Beat ${previewBeatIndex + 1} of ${draft.beats.length}`
                      : "No preview"}
                  </h2>
                </div>
                <span className="border border-[color:var(--rs-border-subtle)] px-2 py-1 text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
                  {previewBeat
                    ? previewBeat.kind === "item"
                      ? "item"
                      : previewBeat.presentationMode
                    : "—"}
                </span>
              </div>
              <div className="mt-4">
                {previewBeat && previewIssues.length === 0 ? (
                  renderPreview({
                    actionMessage: previewActioned
                      ? "Preview only: this action was simulated visually. No mission, item, character, or database state changed."
                      : undefined,
                    beat: previewBeat,
                    controls: previewControls,
                    fullText: previewBeat.text,
                    isComplete:
                      reducedMotion || revealedChars >= Array.from(previewBeat.text).length,
                    onTextClick: () => setRevealedChars(Array.from(previewBeat.text).length),
                    portraitGeneration: previewBeatIndex,
                    visibleText: reducedMotion
                      ? previewBeat.text
                      : Array.from(previewBeat.text).slice(0, revealedChars).join(""),
                  })
                ) : (
                  <div
                    className="border border-[color:var(--rs-accent-warning)] bg-[color:var(--rs-surface-panel)] p-4"
                    role="alert"
                  >
                    <p className="font-display text-sm uppercase tracking-[0.14em] text-[color:var(--rs-accent-warning)]">
                      Preview blocked by validation
                    </p>
                    <ul className="mt-2 space-y-1 text-sm text-[color:var(--rs-text-secondary)]">
                      {(previewIssues.length ? previewIssues : validation.issues)
                        .slice(0, 6)
                        .map((issue) => (
                          <li key={`${issue.path}-${issue.message}`}>{issue.message}</li>
                        ))}
                    </ul>
                  </div>
                )}
              </div>
            </Panel>

            <Panel as="section" className="min-w-0 !p-4 xl:col-span-4" data-qc-studio-editor-panel>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-primary)]">
                    Current beat / sequence editor
                  </p>
                  <h2 className="mt-1 font-display text-lg font-bold">
                    {selectedBeat ? `Beat ${selectedBeatIndex + 1}` : "No beat"}
                  </h2>
                </div>
                <span className="text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
                  {validation.valid
                    ? "Valid draft"
                    : `${validation.issues.length} issue${validation.issues.length === 1 ? "" : "s"}`}
                </span>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <ActionButton
                  data-qc-studio-add-beat
                  intent="secondary"
                  onClick={() => addBeat(false)}
                >
                  Add beat
                </ActionButton>
                <ActionButton
                  data-qc-studio-duplicate-beat
                  intent="secondary"
                  onClick={() => addBeat(true)}
                >
                  Duplicate beat
                </ActionButton>
                <ActionButton
                  disabled={draft.beats.length <= 1}
                  intent="danger"
                  onClick={deleteBeat}
                >
                  Delete beat
                </ActionButton>
                <div className="grid grid-cols-2 gap-2">
                  <ActionButton
                    aria-label="Move beat up"
                    disabled={selectedBeatIndex === 0}
                    intent="secondary"
                    onClick={() => moveBeat(-1)}
                  >
                    ↑ Up
                  </ActionButton>
                  <ActionButton
                    aria-label="Move beat down"
                    disabled={selectedBeatIndex === draft.beats.length - 1}
                    intent="secondary"
                    onClick={() => moveBeat(1)}
                  >
                    ↓ Down
                  </ActionButton>
                </div>
              </div>

              <label
                className="mt-5 block text-sm text-[color:var(--rs-text-secondary)]"
                htmlFor="qc-draft-title"
              >
                Draft name
                <input
                  className={`${CONTROL_CLASS} mt-2`}
                  id="qc-draft-title"
                  onBlur={flushTextHistory}
                  onChange={(event) =>
                    updateTextDraft((current) => ({ ...current, title: event.target.value }))
                  }
                  value={draft.title}
                />
              </label>
              {selectedBeat ? (
                <>
                  <fieldset className="mt-4">
                    <legend className="text-sm text-[color:var(--rs-text-secondary)]">
                      Beat subject
                    </legend>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {(
                        [
                          ["npc", "NPC"],
                          ["item", "Item"],
                        ] as const
                      ).map(([value, label]) => (
                        <label
                          className={`rs-focus border p-3 text-center text-sm ${
                            selectedBeat.kind === value
                              ? "border-[color:var(--rs-accent-primary)] bg-[color:var(--rs-accent-primary-subtle)]"
                              : "border-[color:var(--rs-border-subtle)] bg-[color:var(--rs-surface-panel)]"
                          }`}
                          key={value}
                        >
                          <input
                            checked={selectedBeat.kind === value}
                            className="sr-only"
                            name="qc-beat-subject"
                            onChange={() => switchSubject(selectedBeatIndex, value)}
                            type="radio"
                            value={value}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  {selectedBeat.kind === "npc" ? (
                    <>
                      <label
                        className="mt-4 block text-sm text-[color:var(--rs-text-secondary)]"
                        htmlFor="qc-beat-speaker"
                      >
                        Speaker
                        <select
                          className={`${CONTROL_CLASS} mt-2`}
                          id="qc-beat-speaker"
                          onChange={(event) => {
                            const npc = adapter.npcs.find(
                              (candidate) => candidate.id === event.target.value,
                            );
                            updateBeat(selectedBeatIndex, {
                              speakerNpcId: event.target.value,
                              expressionId: npc?.expressions[0]?.id ?? "",
                            });
                          }}
                          value={selectedBeat.speakerNpcId}
                        >
                          {adapter.npcs.map((npc) => (
                            <option key={npc.id} value={npc.id}>
                              {npc.displayName} — {npc.role}
                            </option>
                          ))}
                        </select>
                      </label>
                      {selectedBeatIssue("speakerNpcId") ? (
                        <Feedback tone="danger">{selectedBeatIssue("speakerNpcId")}</Feedback>
                      ) : null}

                      <label
                        className="mt-4 block text-sm text-[color:var(--rs-text-secondary)]"
                        htmlFor="qc-beat-expression"
                      >
                        Expression
                        <select
                          className={`${CONTROL_CLASS} mt-2`}
                          id="qc-beat-expression"
                          onChange={(event) =>
                            updateBeat(selectedBeatIndex, { expressionId: event.target.value })
                          }
                          value={selectedBeat.expressionId}
                        >
                          {(selectedNpc?.expressions ?? []).map((expression) => (
                            <option key={expression.id} value={expression.id}>
                              {expression.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {selectedBeatIssue("expressionId") ? (
                        <Feedback tone="danger">{selectedBeatIssue("expressionId")}</Feedback>
                      ) : null}

                      <fieldset className="mt-4">
                        <legend className="text-sm text-[color:var(--rs-text-secondary)]">
                          Presentation mode
                        </legend>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          {(
                            [
                              "local",
                              "comms",
                            ] as const satisfies readonly StudioDialoguePresentationMode[]
                          ).map((mode) => (
                            <label
                              className={`rs-focus border p-3 text-center text-sm ${
                                selectedBeat.presentationMode === mode
                                  ? "border-[color:var(--rs-accent-primary)] bg-[color:var(--rs-accent-primary-subtle)]"
                                  : "border-[color:var(--rs-border-subtle)] bg-[color:var(--rs-surface-panel)]"
                              }`}
                              key={mode}
                            >
                              <input
                                checked={selectedBeat.presentationMode === mode}
                                className="sr-only"
                                name="qc-presentation-mode"
                                onChange={() =>
                                  updateBeat(selectedBeatIndex, { presentationMode: mode })
                                }
                                type="radio"
                                value={mode}
                              />
                              {mode === "local" ? "Local" : "Comms"}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    </>
                  ) : (
                    <>
                      <label
                        className="mt-4 block text-sm text-[color:var(--rs-text-secondary)]"
                        htmlFor="qc-beat-item"
                      >
                        Presented item
                        <select
                          className={`${CONTROL_CLASS} mt-2`}
                          id="qc-beat-item"
                          onChange={(event) => selectItem(selectedBeatIndex, event.target.value)}
                          value={selectedBeat.itemId}
                        >
                          {(adapter.items ?? []).map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.displayName}
                              {item.kind === "stack"
                                ? ` (stack up to ${item.stackLimit})`
                                : " (unique)"}
                            </option>
                          ))}
                        </select>
                      </label>
                      {selectedBeatIssue("itemId") ? (
                        <Feedback tone="danger">{selectedBeatIssue("itemId")}</Feedback>
                      ) : null}

                      <label
                        className="mt-4 block text-sm text-[color:var(--rs-text-secondary)]"
                        htmlFor="qc-beat-quantity"
                      >
                        Quantity
                        <input
                          className={`${CONTROL_CLASS} mt-2`}
                          disabled={selectedQuantityRange.max === selectedQuantityRange.min}
                          id="qc-beat-quantity"
                          max={selectedQuantityRange.max}
                          min={selectedQuantityRange.min}
                          onBlur={(event) =>
                            setItemQuantity(selectedBeatIndex, Number(event.target.value))
                          }
                          onChange={(event) =>
                            setItemQuantity(selectedBeatIndex, Number(event.target.value))
                          }
                          step={1}
                          type="number"
                          value={selectedBeat.quantity}
                        />
                      </label>
                      {selectedBeatIssue("quantity") ? (
                        <Feedback tone="danger">{selectedBeatIssue("quantity")}</Feedback>
                      ) : null}

                      <p className="mt-3 border border-[color:var(--rs-border-subtle)] bg-[color:var(--rs-surface-panel)] p-3 text-xs text-[color:var(--rs-text-muted)]">
                        Visual item presentation only. This beat does not grant, remove, or change
                        any inventory; rewards stay server-authoritative.
                      </p>
                    </>
                  )}

                  <label
                    className="mt-4 block text-sm text-[color:var(--rs-text-secondary)]"
                    htmlFor="qc-beat-background"
                  >
                    Conversation background
                    <select
                      className={`${CONTROL_CLASS} mt-2`}
                      id="qc-beat-background"
                      onChange={(event) =>
                        updateBeat(selectedBeatIndex, { backgroundId: event.target.value })
                      }
                      value={selectedBeat.backgroundId}
                    >
                      {adapter.backgrounds.map((background) => (
                        <option key={background.id} value={background.id}>
                          {background.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selectedBeatIssue("backgroundId") ? (
                    <Feedback tone="danger">{selectedBeatIssue("backgroundId")}</Feedback>
                  ) : null}

                  <label
                    className="mt-4 block text-sm text-[color:var(--rs-text-secondary)]"
                    htmlFor="qc-beat-text"
                  >
                    {selectedBeat.kind === "item" ? (
                      <>
                        Caption{" "}
                        <span className="text-xs text-[color:var(--rs-text-muted)]">
                          (optional — the item does not speak)
                        </span>
                      </>
                    ) : (
                      "Dialogue text"
                    )}
                    <textarea
                      aria-describedby={
                        selectedBeatIssue("text") ? "qc-beat-text-error" : undefined
                      }
                      className={`${TEXTAREA_CLASS} mt-2`}
                      id="qc-beat-text"
                      onBlur={flushTextHistory}
                      onChange={(event) => {
                        const text = event.target.value;
                        updateTextDraft((current) => ({
                          ...current,
                          beats: current.beats.map((beat, index) =>
                            index === selectedBeatIndex ? { ...beat, text } : beat,
                          ),
                        }));
                      }}
                      placeholder={
                        selectedBeat.kind === "item"
                          ? "Optional caption…"
                          : "Write the dialogue beat…"
                      }
                      value={selectedBeat.text}
                    />
                  </label>
                  {selectedBeatIssue("text") ? (
                    <p
                      className="mt-2 text-sm text-[color:var(--rs-accent-danger)]"
                      id="qc-beat-text-error"
                      role="alert"
                    >
                      {selectedBeatIssue("text")}
                    </p>
                  ) : null}
                </>
              ) : null}

              <label
                className="mt-4 block text-sm text-[color:var(--rs-text-secondary)]"
                htmlFor="qc-proposed-id"
              >
                Proposed stable content ID{" "}
                <span className="text-xs text-[color:var(--rs-text-muted)]">(optional)</span>
                <input
                  aria-describedby="qc-proposed-id-help"
                  className={`${CONTROL_CLASS} mt-2`}
                  id="qc-proposed-id"
                  onBlur={flushTextHistory}
                  onChange={(event) =>
                    updateTextDraft((current) => ({
                      ...current,
                      ...(event.target.value
                        ? { proposedStableId: event.target.value }
                        : { proposedStableId: undefined }),
                    }))
                  }
                  placeholder="example_dialogue_id"
                  value={draft.proposedStableId ?? ""}
                />
                <span
                  className="mt-1 block text-xs text-[color:var(--rs-text-muted)]"
                  id="qc-proposed-id-help"
                >
                  Proposal only. It does not register an identity in RuneSpace.
                </span>
              </label>
              {validation.issues.find((issue) => issue.path === "proposedStableId") ? (
                <Feedback tone="danger">
                  {validation.issues.find((issue) => issue.path === "proposedStableId")?.message}
                </Feedback>
              ) : null}
            </Panel>
          </div>
        </div>

        <Panel className="mt-5 !p-4" data-qc-studio-actions>
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton
              aria-label="Undo"
              data-qc-studio-undo
              disabled={history.past.length === 0}
              intent="secondary"
              onClick={undo}
            >
              Undo
            </ActionButton>
            <ActionButton
              aria-label="Redo"
              data-qc-studio-redo
              disabled={history.future.length === 0}
              intent="secondary"
              onClick={redo}
            >
              Redo
            </ActionButton>
            <ActionButton data-qc-studio-save intent="secondary" onClick={saveCheckpoint}>
              Save checkpoint
            </ActionButton>
            <ActionButton
              data-qc-studio-reset
              disabled={!sourceSequence}
              intent="danger"
              onClick={resetToSource}
            >
              Reset to Source
            </ActionButton>
            <ActionButton data-qc-studio-copy intent="primary" onClick={copyForRuneSpace}>
              Copy for RuneSpace
            </ActionButton>
          </div>
          <p className="mt-3 text-xs text-[color:var(--rs-text-muted)]">
            Undo/Redo is session-only. The five most recent durable checkpoints live in this browser
            only.
          </p>
          {checkpoints.length ? (
            <details className="mt-4 border-t border-[color:var(--rs-border-subtle)] pt-3">
              <summary className="rs-focus cursor-pointer text-sm font-semibold">
                Recent draft versions ({checkpoints.length}/5)
              </summary>
              <ol className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                {[...checkpoints].reverse().map((checkpoint) => (
                  <li
                    className="border border-[color:var(--rs-border-subtle)] bg-[color:var(--rs-surface-panel)] p-3"
                    key={checkpoint.id}
                  >
                    <p className="text-xs font-semibold">{checkpoint.label}</p>
                    <p className="mt-1 text-[11px] text-[color:var(--rs-text-muted)]">
                      {new Date(checkpoint.savedAt).toLocaleString()}
                    </p>
                    <ActionButton
                      className="mt-3 w-full px-2 text-xs"
                      intent="secondary"
                      onClick={() => restoreCheckpoint(checkpoint)}
                    >
                      Restore
                    </ActionButton>
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
          {exportText ? (
            <label
              className="mt-4 block text-sm text-[color:var(--rs-text-secondary)]"
              htmlFor="qc-export-output"
            >
              Structured export
              <textarea
                className={`${TEXTAREA_CLASS} mt-2 font-mono text-xs`}
                id="qc-export-output"
                readOnly
                rows={10}
                value={exportText}
              />
            </label>
          ) : null}
        </Panel>
      </div>
    </main>
  );
}
