import { notFound } from "next/navigation";
import { ActionButton } from "@/components/ui/ActionButton";
import { CreditsAmount } from "@/components/ui/CreditsAmount";
import { Feedback } from "@/components/ui/Feedback";
import { FormField } from "@/components/ui/FormField";
import { GameShell, TopBar } from "@/components/ui/GameShell";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusMeter } from "@/components/ui/StatusMeter";
import { DialogueScene } from "@/features/dialogue/DialogueScene";
import { creditsReceiptBeat } from "@/features/dialogue/credits-receipt";
import { CONVERSATION_BACKGROUND_IDS } from "@/game/config/foundations";

export const metadata = { title: "Design system preview — RuneSpace" };

/** Development-only visual verification surface. Static labels are not player data. */
export default function DesignSystemPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <GameShell
      topBar={<TopBar title="RuneSpace interface lab" detail="Development-only visual reference" />}
      aside={
        <Panel tone="raised">
          <p className="font-display text-xs uppercase tracking-wider text-[color:var(--rs-accent-primary)]">
            Shell fixture
          </p>
          <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
            Static layout blocks demonstrate responsive space only. They do not represent game
            state.
          </p>
        </Panel>
      }
      bottomNav={
        <div className="mx-auto flex max-w-lg justify-around gap-2">
          <a
            className="rs-focus min-h-[var(--rs-touch-target)] px-3 py-2 text-sm text-[color:var(--rs-accent-primary)]"
            href="#overview"
          >
            Overview
          </a>
          <a
            className="rs-focus min-h-[var(--rs-touch-target)] px-3 py-2 text-sm text-[color:var(--rs-text-secondary)]"
            href="#controls"
          >
            Controls
          </a>
          <a
            className="rs-focus min-h-[var(--rs-touch-target)] px-3 py-2 text-sm text-[color:var(--rs-text-secondary)]"
            href="#states"
          >
            States
          </a>
        </div>
      }
    >
      <div className="space-y-5">
        <Panel id="overview">
          <SectionHeader eyebrow="Token single source of truth">Visual foundation</SectionHeader>
          <p className="mt-3 text-sm text-[color:var(--rs-text-secondary)]">
            Deep surfaces, readable text, semantic accents, restrained glow, and shared bevel
            geometry live in global tokens.
          </p>
        </Panel>
        <Panel id="controls" tone="raised">
          <h2 className="font-display text-lg font-bold">Action variants</h2>
          <div className="mt-4 flex flex-wrap gap-3">
            <ActionButton>Primary</ActionButton>
            <ActionButton intent="success">Valid</ActionButton>
            <ActionButton intent="mining">Caution</ActionButton>
            <ActionButton intent="arcane">Unusual</ActionButton>
            <ActionButton intent="danger">Blocked</ActionButton>
            <ActionButton disabled>Disabled</ActionButton>
          </div>
        </Panel>
        <Panel>
          <h2 className="font-display text-lg font-bold">Form controls and status</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <FormField id="lab-field" label="Example label" placeholder="Readable input" />
            <div className="space-y-4 pt-1">
              <StatusMeter label="Example meter" value={62} detail="62%" />
              <Feedback>Empty state: no development fixture selected.</Feedback>
              <Feedback tone="danger">Error state: example validation message.</Feedback>
            </div>
          </div>
        </Panel>
        <Panel id="credits" tone="raised">
          <h2 className="font-display text-lg font-bold">Credits</h2>
          <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
            The inline icon is 1em tall and follows the surrounding text. Static amounts only.
          </p>
          <div className="mt-4 space-y-2" data-credits-specimens>
            <p className="font-display text-xl font-bold">
              Heading <CreditsAmount amount={1234} />
            </p>
            <p className="font-display text-sm font-bold text-[color:var(--rs-accent-primary)]">
              <CreditsAmount amount={42} />
            </p>
            <p className="text-base">
              Body text <CreditsAmount amount={42} /> in a sentence.
            </p>
            <p className="text-xs text-[color:var(--rs-text-secondary)]">
              Tight row <CreditsAmount amount={12} /> each · carried 3
            </p>
            <p className="flex items-center gap-2 text-xs">
              Flex row <CreditsAmount amount={5} unit="Cr" />
            </p>
            <div className="flex flex-wrap gap-3">
              <ActionButton intent="secondary">
                <span>
                  Ride to The Jag · <CreditsAmount amount={5} />
                </span>
              </ActionButton>
              <ActionButton className="px-3 text-xs" intent="secondary">
                <span>
                  Post ad · <CreditsAmount amount={50} />
                </span>
              </ActionButton>
            </div>
          </div>
          <div className="mt-4 max-w-xl" data-credits-reward-specimen>
            <DialogueScene
              beat={creditsReceiptBeat(
                500,
                CONVERSATION_BACKGROUND_IDS.holoHollowAssistanceCenterInterior,
              )}
            />
          </div>
        </Panel>
        <Panel id="states">
          <h2 className="font-display text-lg font-bold">Loading and empty states</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="border border-dashed border-[color:var(--rs-border-structural)] p-4 text-sm text-[color:var(--rs-text-muted)]">
              No fixture content is loaded.
            </div>
            <ActionButton loading className="w-full">
              Loading
            </ActionButton>
          </div>
        </Panel>
      </div>
    </GameShell>
  );
}
