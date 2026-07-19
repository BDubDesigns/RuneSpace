export function StatusMeter({
  label,
  value,
  detail,
}: {
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-2 text-xs text-[color:var(--rs-text-secondary)]">
        <span>{label}</span>
        <span>{detail}</span>
      </div>
      <div
        aria-label={`${label}: ${detail}`}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={value}
        className="mt-2 h-1.5 overflow-hidden bg-[color:var(--rs-border-subtle)]"
        role="progressbar"
      >
        <div
          className="h-full bg-[color:var(--rs-accent-primary)]"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}
