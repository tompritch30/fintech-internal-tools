export const ROLES = ["analyst", "approver", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "platform:access",
  "audit:read",
  "approvals:request",
  "approvals:decide",
  "pii:unmask",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Role → permission map. Changing it is a change to packages/core (human review). */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  analyst: ["platform:access", "approvals:request"],
  approver: ["platform:access", "approvals:decide", "pii:unmask"],
  admin: ["platform:access", "audit:read"],
};

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function permissionsFor(roles: readonly string[]): Set<Permission> {
  const result = new Set<Permission>();
  for (const role of roles) {
    if (isRole(role)) for (const p of ROLE_PERMISSIONS[role]) result.add(p);
  }
  return result;
}
