import { ValidationError } from "../errors.ts";

export const ROLES = ["analyst", "approver", "admin"] as const;
export type Role = (typeof ROLES)[number];

export interface PermissionDef {
  description: string;
  roles: readonly Role[];
}

const PERMISSION_NAME = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/;

/**
 * Declares the permission registry: every permission is a `domain:action` key with a
 * description and the roles it grants. Validated and deep-frozen at module load, so a
 * bad entry fails startup rather than silently granting or withholding access.
 */
export function definePermissionRegistry<const R extends Record<string, PermissionDef>>(defs: R): Readonly<R> {
  for (const [key, def] of Object.entries(defs)) {
    if (!PERMISSION_NAME.test(key)) {
      throw new ValidationError(`permission key must match domain:action (lowercase), got: ${key}`);
    }
    if (def.description.trim() === "") {
      throw new ValidationError(`permission ${key} needs a non-empty description`);
    }
    if (def.roles.length === 0) {
      throw new ValidationError(`permission ${key} must grant at least one role`);
    }
    if (new Set(def.roles).size !== def.roles.length) {
      throw new ValidationError(`permission ${key} lists a role more than once`);
    }
    for (const role of def.roles) {
      if (!isRole(role)) {
        throw new ValidationError(`permission ${key} grants unknown role: ${String(role)}`);
      }
    }
  }
  for (const def of Object.values(defs)) {
    Object.freeze(def.roles);
    Object.freeze(def);
  }
  return Object.freeze(defs);
}

/** Role → permission map is derived from the registry; changing it is a change to packages/core (human review). */
export const PERMISSION_REGISTRY = definePermissionRegistry({
  "platform:access": { description: "Sign in and use the platform", roles: ["analyst", "approver", "admin"] },
  "audit:read": { description: "Read the audit log", roles: ["admin"] },
  "approvals:request": { description: "Raise an approval request", roles: ["analyst"] },
  "approvals:decide": { description: "Approve or reject an approval request", roles: ["approver"] },
  "pii:unmask": { description: "Unmask a masked field with a recorded reason", roles: ["approver"] },
  "refunds:read": { description: "View payments and refunds", roles: ["analyst", "approver"] },
  "refunds:request": { description: "Request a refund on a payment", roles: ["analyst"] },
  "refunds:approve": { description: "Approve or reject a refund over the approval threshold", roles: ["approver"] },
  "kyc:read": { description: "View the KYC review queue and cases (masked)", roles: ["analyst", "approver"] },
  "kyc:request": { description: "Claim a KYC case and approve, reject or escalate it", roles: ["analyst"] },
  "kyc:approve": { description: "Give the four-eyes sign-off on a high-risk KYC approval", roles: ["approver"] },
  "flags:read": { description: "View feature flags and their history", roles: ["analyst", "approver"] },
  "flags:request": {
    description: "Change dev and staging flag values, request prod changes and use the prod kill switch",
    roles: ["analyst"],
  },
  "flags:approve": { description: "Approve or reject a prod feature flag change", roles: ["approver"] },
});

export const PERMISSIONS = Object.keys(PERMISSION_REGISTRY) as readonly (keyof typeof PERMISSION_REGISTRY)[];
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = (() => {
  const map: Record<Role, Permission[]> = { analyst: [], approver: [], admin: [] };
  for (const [permission, def] of Object.entries(PERMISSION_REGISTRY)) {
    for (const role of def.roles) map[role].push(permission as Permission);
  }
  for (const role of ROLES) Object.freeze(map[role]);
  return Object.freeze(map);
})();

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

export function permissionsFor(roles: readonly string[]): Set<Permission> {
  const result = new Set<Permission>();
  for (const role of roles) {
    if (isRole(role)) for (const p of ROLE_PERMISSIONS[role]) result.add(p);
  }
  return result;
}
