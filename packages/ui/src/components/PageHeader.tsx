import type { ReactNode } from "react";

/** Title and one-line description at the top of a list or dashboard page. */
export function PageHeader({ title, description }: { title: ReactNode; description?: ReactNode }) {
  return (
    <header className="flex flex-col gap-1">
      <h1>{title}</h1>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
    </header>
  );
}

/** Classes for text links (works with next/link, which the kit can't import). */
export const linkClass = "font-medium text-foreground underline-offset-4 hover:underline";
