"use client";

export function percentageBps(bps: number): string {
  return (bps / 100).toFixed(2);
}

export function SkillProgressCard({
  title,
  level,
  totalXp,
  xpIntoLevel,
  xpToNextLevel,
}: {
  title: string;
  level: number;
  totalXp: number;
  xpIntoLevel: number;
  xpToNextLevel?: number;
}) {
  const accent = title.toLowerCase().includes("refining")
    ? "var(--rs-accent-arcane)"
    : "var(--rs-accent-mining)";
  return (
    <div className="rounded border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-4">
      <p className="font-display text-xs uppercase tracking-[0.16em]" style={{ color: accent }}>
        {title}
      </p>
      <p className="mt-3 font-display text-3xl font-bold">Level {level}</p>
      <div
        className="mt-3 h-1.5 overflow-hidden bg-[color:var(--rs-border-subtle)]"
        role="progressbar"
        aria-valuenow={
          xpToNextLevel ? Math.min(100, (xpIntoLevel / (xpIntoLevel + xpToNextLevel)) * 100) : 100
        }
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${title} XP`}
      >
        <div
          className="h-full"
          style={{
            width: `${xpToNextLevel ? Math.min(100, (xpIntoLevel / (xpIntoLevel + xpToNextLevel)) * 100) : 100}%`,
            background: accent,
          }}
        />
      </div>
      <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
        {xpToNextLevel ? `${xpToNextLevel} XP to next level` : "Maximum level"}
      </p>
      <p className="mt-1 text-sm text-[color:var(--rs-text-muted)]">
        {totalXp.toLocaleString()} total XP
      </p>
    </div>
  );
}

export function AttemptHistoryList({
  attempts,
  renderAttempt,
  emptyText,
}: {
  attempts: readonly unknown[];
  renderAttempt: (attempt: unknown, index: number) => React.ReactNode;
  emptyText: string;
}) {
  if (attempts.length === 0) {
    return <p className="text-sm text-[color:var(--rs-text-muted)]">{emptyText}</p>;
  }
  return (
    <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1" role="list">
      {[...attempts].reverse().map((a, i) => (
        <div key={i}>{renderAttempt(a, i)}</div>
      ))}
    </div>
  );
}
