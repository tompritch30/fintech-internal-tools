import type { ReactNode } from "react";

/** Dashboard tile linking to an app. Show only apps the user may open. */
export function AppTile({ href, title, description, icon, stat }: { href: string; title: string; description: string; icon?: ReactNode; stat?: string }) {
  return (
    <a
      href={href}
      className="flex flex-col gap-2 rounded-lg border bg-card p-4 text-card-foreground shadow-xs transition-colors hover:bg-muted/40 [&_svg]:size-5 [&_svg]:text-muted-foreground"
    >
      <span className="flex items-center gap-2">
        {icon ? <span aria-hidden className="contents">{icon}</span> : null}
        <span className="font-semibold">{title}</span>
      </span>
      <span className="text-sm text-muted-foreground">{description}</span>
      {stat ? <span className="text-xs font-medium text-foreground">{stat}</span> : null}
    </a>
  );
}

export function TileGrid({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {children}
    </div>
  );
}
