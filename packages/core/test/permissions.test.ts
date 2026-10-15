import { describe, expect, it } from "vitest";
import {
  ROLE_PERMISSIONS,
  ValidationError,
  definePermissionRegistry,
  isPermission,
  type PermissionDef,
} from "../src/index.ts";

const def = (roles: readonly ("analyst" | "approver" | "admin")[] = ["analyst"]): PermissionDef => ({
  description: "test permission",
  roles,
});

describe("definePermissionRegistry", () => {
  it.each([
    {
      label: "a bad name",
      defs: { "BadName": def() },
    },
    {
      label: "an empty description",
      defs: { "test:x": { description: "   ", roles: ["analyst"] } },
    },
    {
      label: "no roles",
      defs: { "test:x": { description: "x", roles: [] } },
    },
    {
      label: "an unknown role",
      defs: { "test:x": { description: "x", roles: ["superuser"] as never } },
    },
    {
      label: "a duplicate role",
      defs: { "test:x": { description: "x", roles: ["analyst", "analyst"] } },
    },
  ])("rejects $label", ({ defs }) => {
    expect(() => definePermissionRegistry(defs as never)).toThrow(ValidationError);
  });

  it("accepts a valid registry and freezes it", () => {
    const registry = definePermissionRegistry({ "test:x": def(["analyst", "approver"]) });
    expect(Object.isFrozen(registry)).toBe(true);
    expect(registry["test:x"].roles).toEqual(["analyst", "approver"]);
  });

  it("rejects an unknown role at compile time too", () => {
    const compileCheck = () => {
      // @ts-expect-error roles must be known Role values
      definePermissionRegistry({ "test:x": { description: "x", roles: ["superuser"] } });
    };
    expect(compileCheck).toBeTypeOf("function");
    // control: a valid call compiles
    expect(definePermissionRegistry({ "test:y": def() })["test:y"].description).toBe("test permission");
  });
});

describe("permission registry", () => {
  it("ROLE_PERMISSIONS is unchanged by the registry", () => {
    const sorted = (p: readonly string[]) => [...p].sort();
    expect(sorted(ROLE_PERMISSIONS.analyst)).toEqual(sorted(["platform:access", "approvals:request"]));
    expect(sorted(ROLE_PERMISSIONS.approver)).toEqual(sorted(["platform:access", "approvals:decide", "pii:unmask"]));
    expect(sorted(ROLE_PERMISSIONS.admin)).toEqual(sorted(["platform:access", "audit:read"]));
  });

  it("admin holds no approve or unmask permission", () => {
    expect(ROLE_PERMISSIONS.admin).not.toContain("approvals:decide");
    expect(ROLE_PERMISSIONS.admin).not.toContain("pii:unmask");
  });

  it("isPermission accepts registered permissions and rejects others", () => {
    for (const p of ["platform:access", "audit:read", "approvals:request", "approvals:decide", "pii:unmask"]) {
      expect(isPermission(p)).toBe(true);
    }
    for (const p of ["refunds:approve", "admin", "platform:acces", "", "approvals:decide "]) {
      expect(isPermission(p)).toBe(false);
    }
  });
});
