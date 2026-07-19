import type { InputHTMLAttributes } from "react";

type FormFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
};

export function FormField({ label, id, className = "", ...props }: FormFieldProps) {
  return (
    <label className="block text-sm font-medium text-[color:var(--rs-text-secondary)]" htmlFor={id}>
      {label}
      <input
        {...props}
        id={id}
        className={`rs-bevel rs-focus mt-2 min-h-[var(--rs-control-height)] w-full border bg-[color:var(--rs-surface-control)] px-3 text-[color:var(--rs-text-primary)] transition placeholder:text-[color:var(--rs-text-muted)] focus:border-[color:var(--rs-accent-primary)] ${className}`}
      />
    </label>
  );
}
