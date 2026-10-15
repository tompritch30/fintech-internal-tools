import type { ReactNode } from "react";
import { headers } from "next/headers";
import { AppShell, Button, type NavItem } from "@fit/ui";
import { requireUser } from "../../lib/auth.ts";

export const dynamic = "force-dynamic";

export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const currentPath = (await headers()).get("x-pathname") ?? "/";
  // Only link to pages the user may open (no forbidden links, so no denied prefetches).
  const nav: NavItem[] = [];
  if (user.permissions.has("platform:access")) {
    nav.push({ href: "/", label: "Home" }, { href: "/demo-record", label: "Demo record" });
  }
  if (user.permissions.has("audit:read")) nav.push({ href: "/audit", label: "Audit log" });

  return (
    <AppShell
      appName="Internal tools"
      nav={nav}
      currentPath={currentPath}
      user={user.displayName ?? user.username}
      headerActions={
        <form method="post" action="/auth/logout">
          <Button type="submit">Sign out</Button>
        </form>
      }
    >
      {children}
    </AppShell>
  );
}
