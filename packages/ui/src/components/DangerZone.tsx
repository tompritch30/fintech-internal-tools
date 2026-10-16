import type { ReactNode } from "react";

/**
 * A record section for an emergency or hard-to-undo action (e.g. a kill switch), kept apart from
 * the ActionPanel so it isn't clicked by mistake. Pass only actions the user can take.
 */
export function DangerZone({ title = "Danger zone", description, children }: { title?: string; description?: ReactNode; children: ReactNode }) {
  const id = `section-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id}>{title}</h2>
      <div className="flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-card-foreground">
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        {children}
      </div>
    </section>
  );
}
