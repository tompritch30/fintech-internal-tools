import type { ReactNode } from "react";
import { Circle } from "lucide-react";
import { UserMenu } from "./UserMenu.tsx";

export interface NavItem {
  href: string;
  label: string;
  /** Optional icon (e.g. a lucide-react icon element) shown before the label. */
  icon?: ReactNode;
}

function isActive(item: NavItem, currentPath: string): boolean {
  return currentPath === item.href || (item.href !== "/" && currentPath.startsWith(`${item.href}/`));
}

/** App frame: left navigation, header with the signed-in user, and the main area. Pass only nav items the user may open. */
export function AppShell({
  appName,
  nav,
  currentPath,
  user,
  roles,
  headerActions,
  children,
}: {
  appName: string;
  nav: NavItem[];
  currentPath: string;
  user: string;
  /** Shown in the account menu. */
  roles?: string[];
  headerActions?: ReactNode;
  children: ReactNode;
}) {
  const current = nav.find((item) => isActive(item, currentPath));
  return (
    <div className="flex min-h-svh bg-background">
      <aside className="sticky top-0 flex h-svh w-14 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:w-60">
        <div className="flex h-14 items-center px-4">
          <span className="truncate text-sm font-semibold tracking-tight text-sidebar-accent-foreground max-md:sr-only">{appName}</span>
        </div>
        <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 py-2 md:px-3">
          <ul className="flex flex-col gap-0.5">
            {nav.map((item) => {
              const active = isActive(item, currentPath);
              return (
                <li key={item.href}>
                  <a
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    title={item.label}
                    className="flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-medium aria-[current=page]:text-sidebar-accent-foreground max-md:justify-center [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground aria-[current=page]:[&_svg]:text-primary"
                  >
                    <span aria-hidden className="contents">
                      {item.icon ?? <Circle />}
                    </span>
                    <span className="truncate max-md:sr-only">{item.label}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between gap-4 border-b bg-background/80 px-4 backdrop-blur md:px-6">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <span className="text-muted-foreground max-md:hidden">{appName}</span>
            {current ? (
              <>
                <span aria-hidden className="text-muted-foreground/60 max-md:hidden">
                  /
                </span>
                <span className="truncate font-medium text-foreground">{current.label}</span>
              </>
            ) : null}
          </div>
          <UserMenu user={user} roles={roles}>{headerActions}</UserMenu>
        </header>
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
