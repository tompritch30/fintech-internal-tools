"use client";

import { useActionState, useEffect, useId, useRef, type ReactNode } from "react";
import { Button, type ButtonVariant } from "./Button.tsx";

/** What an action returns to its form: an error to show, or a result. */
export interface ActionState {
  error?: string;
  message?: string;
  revealed?: string;
}

export type FormAction = (state: ActionState, form: FormData) => Promise<ActionState>;

/**
 * A button that opens a small dialog with a form (extra fields as children) and submits
 * a server action. Uses the HTML popover attribute, so it opens without JavaScript too.
 */
export function ActionDialog({
  label,
  ariaLabel,
  title,
  description,
  action,
  hidden = {},
  submitLabel,
  variant = "default",
  children,
  onResult,
}: {
  label: string;
  /** Accessible name for the trigger when `label` alone is ambiguous (e.g. several "Reveal" buttons). */
  ariaLabel?: string;
  title?: string;
  description?: ReactNode;
  action: FormAction;
  hidden?: Record<string, string | number>;
  submitLabel?: string;
  variant?: ButtonVariant;
  children?: ReactNode;
  /** Rendered under the trigger after a successful submit. */
  onResult?: (state: ActionState) => ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const succeeded = !state.error && (state.message !== undefined || state.revealed !== undefined);
  useEffect(() => {
    if (succeeded && ref.current?.matches(":popover-open")) ref.current.hidePopover();
  }, [state, succeeded]);
  return (
    <div className="flex flex-col gap-1">
      <Button type="button" variant={variant} popoverTarget={`${id}-dialog`} aria-label={ariaLabel}>
        {label}
      </Button>
      <div
        ref={ref}
        id={`${id}-dialog`}
        popover="auto"
        role="dialog"
        aria-labelledby={`${id}-title`}
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border bg-popover p-5 text-popover-foreground shadow-lg backdrop:bg-black/30"
      >
        <form action={formAction} className="flex flex-col gap-4" aria-label={title ?? label}>
          <div className="flex flex-col gap-1">
            <h2 id={`${id}-title`}>{title ?? label}</h2>
            {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
          </div>
          {Object.entries(hidden).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          {children}
          {state.error ? (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" popoverTarget={`${id}-dialog`} popoverTargetAction="hide">
              Cancel
            </Button>
            <Button type="submit" variant={variant === "default" ? "primary" : variant} disabled={pending}>
              {submitLabel ?? label}
            </Button>
          </div>
        </form>
      </div>
      {succeeded && state.message ? (
        <p role="status" className="text-sm text-muted-foreground">
          {state.message}
        </p>
      ) : null}
      {succeeded && onResult ? onResult(state) : null}
    </div>
  );
}

/** A one-click action (no extra input), e.g. "Claim case". Shows the server's error or message. */
export function ActionButton({
  label,
  action,
  hidden = {},
  variant = "default",
}: {
  label: string;
  action: FormAction;
  hidden?: Record<string, string | number>;
  variant?: ButtonVariant;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} aria-label={label} className="flex flex-col gap-1">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button type="submit" variant={variant} disabled={pending}>
        {label}
      </Button>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : state.message ? (
        <p role="status" className="text-sm text-muted-foreground">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
