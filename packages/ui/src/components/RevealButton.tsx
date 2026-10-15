"use client";

import { useId } from "react";
import { ActionDialog, type FormAction } from "./ActionDialog.tsx";
import { Input } from "./Input.tsx";

/**
 * A masked value with one Reveal button. The button opens a small dialog that asks for the
 * reason; the server action checks the permission, records the reason in the audit log and
 * returns the value. `display="block"` shows long content (e.g. a document) below the button.
 */
export function RevealButton({
  what,
  masked,
  action,
  hidden,
  minReasonLength,
  label = "Reveal",
  display = "inline",
}: {
  /** What is revealed, in words: "customer email", "ID number", "utility_bill.pdf". */
  what: string;
  /** The masked value shown until revealed (omit for documents). */
  masked?: string;
  action: FormAction;
  hidden: Record<string, string>;
  minReasonLength: number;
  label?: string;
  display?: "inline" | "block";
}) {
  const id = useId();
  return (
    <div className={display === "inline" ? "flex flex-wrap items-center gap-2" : "flex flex-col gap-2"}>
      <ActionDialog
        label={label}
        ariaLabel={`${label} ${what}`}
        title={`Reveal ${what}`}
        description="Give a reason. The reason and the reveal are recorded in the audit log."
        submitLabel="Reveal"
        action={action}
        hidden={hidden}
        onResult={(state) =>
          display === "inline" ? (
            <span role="status" className="text-sm">
              <strong data-testid={`revealed-${what.replace(/\W+/g, "-")}`}>{state.revealed}</strong>{" "}
              <span className="text-xs text-muted-foreground">(audited)</span>
            </span>
          ) : (
            <pre role="status" aria-label={`Contents of ${what}`} className="w-full rounded-md border bg-muted/40 p-3 text-sm whitespace-pre-wrap">
              {state.revealed}
            </pre>
          )
        }
      >
        <Input id={`${id}-reason`} name="reason" label="Reason" required minLength={minReasonLength} maxLength={500} autoFocus />
      </ActionDialog>
      {masked !== undefined && display === "inline" ? <span className="order-first">{masked}</span> : null}
    </div>
  );
}
