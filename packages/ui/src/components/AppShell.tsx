import type { ReactNode } from "react";

export interface NavItem {
  href: string;
  label: string;
}

/** App frame: left navigation, header with the signed-in user, and the main area. Pass only nav items the user may open. */
export function AppShell({
  appName,
  nav,
  currentPath,
  user,
  headerActions,
  children,
}: {
  appName: string;
  nav: NavItem[];
  currentPath: string;
  user: string;
  headerActions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="fit-shell">
      <nav className="fit-shell__nav" aria-label="Main">
        <div className="fit-shell__brand">{appName}</div>
        <ul>
          {nav.map((item) => (
            <li key={item.href}>
              <a href={item.href} aria-current={currentPath === item.href ? "page" : undefined}>
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div>
        <header className="fit-shell__header">
          <span>
            Signed in as <strong data-testid="current-user">{user}</strong>
          </span>
          {headerActions}
        </header>
        <main className="fit-shell__main">{children}</main>
      </div>
    </div>
  );
}
