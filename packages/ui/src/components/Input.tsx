import type { InputHTMLAttributes } from "react";

export function Input({ label, id, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; id: string }) {
  return (
    <div className="fit-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} className={["fit-input", className].filter(Boolean).join(" ")} {...props} />
    </div>
  );
}
