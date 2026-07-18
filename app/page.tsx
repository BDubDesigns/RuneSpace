import { ScaffoldScreen } from "@/components/ScaffoldScreen";

/**
 * Landing / smoke screen.
 *
 * Intentionally minimal. It identifies RuneSpace as an early scaffold and does
 * NOT contain any gameplay, lore, quests, NPCs, resources, balance values, or
 * interactions. Those arrive in later issues, server-authoritatively.
 */
export default function HomePage() {
  return (
    <ScaffoldScreen>
      <h1 className="font-mono text-2xl font-bold tracking-tight text-emerald-400 sm:text-3xl">
        RuneSpace
      </h1>
      <p className="mt-2 text-sm text-slate-400">Development scaffold online.</p>
      <p className="mt-4 text-xs leading-relaxed text-slate-500">
        Systems initializing. This is an early foundation build, not a playable game. Architecture,
        tooling, and tests are being established before gameplay work begins.
      </p>
    </ScaffoldScreen>
  );
}
