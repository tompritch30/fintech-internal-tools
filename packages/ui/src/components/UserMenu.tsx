"use client";

import type { ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ChevronsUpDown } from "lucide-react";
import { StatusBadge } from "./StatusBadge.tsx";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? "?";
  const last = parts.length > 1 ? (parts[parts.length - 1] ?? "") : "";
  return (last ? first.charAt(0) + last.charAt(0) : first.slice(0, 2)).toUpperCase();
}

/**
 * Top-right account menu: the signed-in user and their roles, with the shell's header actions (e.g. Sign out) inside.
 * Without JavaScript the popover can't open, so the actions are also rendered in a <noscript> fallback.
 */
export function UserMenu({ user, roles, children }: { user: string; roles?: string[]; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <Popover.Root>
        <Popover.Trigger
          aria-label={`Account menu for ${user}`}
          className="flex h-9 cursor-pointer items-center gap-2 rounded-md px-1.5 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 data-[state=open]:bg-accent"
        >
          <span aria-hidden className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
            {initials(user)}
          </span>
          <span className="hidden font-medium sm:inline" data-testid="current-user">
            {user}
          </span>
          <ChevronsUpDown aria-hidden className="size-4 text-muted-foreground" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={6}
            className="z-50 w-60 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg outline-none"
          >
            <div className="px-2 py-1.5">
              <div className="text-xs text-muted-foreground">Signed in as</div>
              <div className="truncate text-sm font-medium">{user}</div>
            </div>
            {roles ? (
              <div className="px-2 pb-2">
                <div className="text-xs text-muted-foreground">Roles</div>
                <ul aria-label="Your roles" className="mt-1 flex flex-wrap gap-1">
                  {roles.length === 0 ? <li className="text-sm">None</li> : null}
                  {roles.map((r) => (
                    <li key={r}>
                      <StatusBadge label={r} />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {children ? (
              <>
                <div role="separator" className="-mx-1 my-1 h-px bg-border" />
                <div className="flex flex-col">{children}</div>
              </>
            ) : null}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {children ? (
        <noscript>
          <div className="flex items-center">{children}</div>
        </noscript>
      ) : null}
    </div>
  );
}
