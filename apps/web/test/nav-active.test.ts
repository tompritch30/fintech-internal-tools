import { describe, expect, it } from "vitest";
import { activeNavHref } from "@fit/ui";

const nav = [
  { href: "/", label: "Home" },
  { href: "/refunds", label: "Refunds" },
  { href: "/refunds/approvals", label: "Approvals" },
  { href: "/flags", label: "Feature flags" },
  { href: "/flags/approvals", label: "Flag approvals" },
];

describe("main navigation marks exactly one item as the current page", () => {
  it("marks the approvals queue, not its parent app, on /refunds/approvals and /flags/approvals", () => {
    expect(activeNavHref(nav, "/refunds/approvals")).toBe("/refunds/approvals");
    expect(activeNavHref(nav, "/flags/approvals")).toBe("/flags/approvals");
  });

  it("still marks the parent app on its own pages and records", () => {
    expect(activeNavHref(nav, "/refunds")).toBe("/refunds");
    expect(activeNavHref(nav, "/refunds/requests/abc")).toBe("/refunds");
    expect(activeNavHref(nav, "/flags/abc")).toBe("/flags");
  });

  it("marks Home only on /, and nothing on an unknown path", () => {
    expect(activeNavHref(nav, "/")).toBe("/");
    expect(activeNavHref(nav, "/audit")).toBeUndefined();
  });
});
