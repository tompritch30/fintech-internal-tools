import type { ButtonHTMLAttributes } from "react";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn.ts";

export type ButtonVariant = "default" | "primary" | "danger" | "ghost";

const buttonVariants = cva(
  "inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 text-sm font-medium no-underline transition-colors select-none focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border border-input bg-background text-foreground shadow-xs hover:bg-accent hover:text-accent-foreground",
        primary: "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
        danger: "bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/40",
        ghost: "text-foreground hover:bg-accent hover:text-accent-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

/** Button classes, for links styled as buttons (`<a className={buttonClass("primary")}>`). */
export function buttonClass(variant: ButtonVariant = "default"): string {
  return buttonVariants({ variant });
}

export function Button({
  variant = "default",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button type={type} className={cn(buttonClass(variant), className)} {...props} />;
}
