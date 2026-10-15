import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "default" | "primary" | "danger";

export function buttonClass(variant: ButtonVariant = "default"): string {
  return variant === "default" ? "fit-button" : `fit-button fit-button--${variant}`;
}

export function Button({
  variant = "default",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button type={type} className={[buttonClass(variant), className].filter(Boolean).join(" ")} {...props} />;
}
