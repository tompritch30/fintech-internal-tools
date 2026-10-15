import type { ReactNode } from "react";
import { cva } from "class-variance-authority";

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium [&+&]:ml-1.5",
  {
    variants: {
      tone: {
        neutral: "border-border bg-muted text-secondary-foreground",
        info: "border-primary/20 bg-primary/10 text-primary",
        success: "border-success/25 bg-success/10 text-success",
        warning: "border-warning/30 bg-warning/10 text-warning",
        danger: "border-destructive/20 bg-destructive/10 text-destructive",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={badgeVariants({ tone })}>{children}</span>;
}
