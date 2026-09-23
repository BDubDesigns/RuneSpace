import type { InputHTMLAttributes } from "react";

type FormFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  /** Optional helper text below the input, announced with it via `aria-describedby`. */
  description?: string;
};

export function FormField({ label, id, description, className = "", ...props }: FormFieldProps) {
  const descriptionId = description && id ? `${id}-description` : undefined;
  return (
    <label className="block text-sm font-medium text-[color:var(--rs-text-secondary)]" htmlFor={id}>
      {label}
      <input
        {...props}
        id={id}
        aria-describedby={descriptionId}
        className={`rs-bevel rs-focus mt-2 min-h-[var(--rs-control-height)] w-full border bg-[color:var(--rs-surface-control)] px-3 text-[color:var(--rs-text-primary)] transition placeholder:text-[color:var(--rs-text-muted)] focus:border-[color:var(--rs-accent-primary)] ${className}`}
      />
      {description ? (
        <span
          id={descriptionId}
          className="mt-1.5 block text-xs font-normal text-[color:var(--rs-text-muted)]"
        >
          {description}
        </span>
      ) : null}
    </label>
  );
}
