import type { ReactNode } from "react";
import { headers } from "next/headers";
import { Banknote, ClipboardCheck, House, LogOut, ScrollText, SquareKanban } from "lucide-react";
import { AppShell, Button, type NavItem } from "@fit/ui";
import { requireUser } from "../../lib/auth.ts";

export const dynamic = "force-dynamic";

export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const currentPath = (await headers()).get("x-pathname") ?? "/";
  // Only link to pages the user may open (no forbidden links, so no denied prefetches).
  const nav: NavItem[] = [];
  if (user.permissions.has("platform:access")) {
    nav.push(
      { href: "/", label: "Home", icon: <House /> },
      { href: "/demo-record", label: "Demo record", icon: <SquareKanban /> },
    );
  }
  if (user.permissions.has("approvals:request") || user.permissions.has("approvals:decide")) {
    nav.push({ href: "/refunds", label: "Refunds", icon: <Banknote /> });
  }
  if (user.permissions.has("approvals:decide")) nav.push({ href: "/refunds/approvals", label: "Approvals", icon: <ClipboardCheck /> });
  if (user.permissions.has("audit:read")) nav.push({ href: "/audit", label: "Audit log", icon: <ScrollText /> });

  return (
    <AppShell
      appName="Internal tools"
      nav={nav}
      currentPath={currentPath}
      user={user.displayName ?? user.username}
      headerActions={
        <form method="post" action="/auth/logout">
          <Button type="submit" variant="ghost" className="h-8 w-full justify-start px-2">
            <LogOut aria-hidden />
            Sign out
          </Button>
        </form>
      }
    >
      {children}
    </AppShell>
  );
}
