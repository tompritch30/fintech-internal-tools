import type { InputHTMLAttributes } from "react";
import { cn } from "../lib/cn.ts";

/** Text input classes, for inputs rendered outside `Input` (e.g. the ListView search box). */
export const inputClass =
  "flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive";

export function Input({ label, id, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; id: string }) {
  return (
    <div className="grid min-w-64 gap-1.5">
      <label htmlFor={id} className="text-sm font-medium leading-none text-foreground">
        {label}
      </label>
      <input id={id} className={cn(inputClass, className)} {...props} />
    </div>
  );
}
