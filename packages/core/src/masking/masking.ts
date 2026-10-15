import "server-only";
import type { Db, Tx } from "@fit/db";
import { withAudit } from "../audit/with-audit.ts";
import { requirePermission } from "../rbac/guards.ts";
import { NotFoundError, ValidationError } from "../errors.ts";
import type { Permission } from "../rbac/permissions.ts";
import type { SessionUser } from "../session/session.ts";

export type MaskStyle = "last4" | "full" | "email" | "name";

/** Keys of T whose values are strings (or nullable/optional strings). */
type StringField<T> = {
  [K in keyof T]-?: T[K] extends string | null | undefined ? K : never;
}[keyof T] &
  string;

export interface MaskPolicy<F extends string = string> {
  field: F;
  style: MaskStyle;
  unmaskPermission: Permission;
}

declare const maskedBrand: unique symbol;
export type MaskedValue = string & { readonly [maskedBrand]: "MaskedValue" };
export type Masked<T, F extends keyof T> = {
  [K in keyof T]: K extends F ? MaskedValue | Extract<T[K], null | undefined> : T[K];
} & { readonly [maskedBrand]: "Masked" };

type Primitive = string | number | boolean | bigint | symbol | null | undefined;
/** Keys of T holding anything but primitives or Date (objects, arrays, unknown/jsonb). */
type NestedKeys<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends Primitive | Date ? never : K;
}[keyof T];

const BULLET = "•";
/** Fixed length so the masked value doesn't leak the original's length. */
const FULL = BULLET.repeat(8);

function maskValue(value: string, style: MaskStyle): string {
  switch (style) {
    case "last4":
      return value.length >= 8 ? BULLET.repeat(4) + value.slice(-4) : FULL;
    case "full":
      return FULL;
    case "email": {
      const at = value.indexOf("@");
      if (at < 0) return FULL;
      const local = value.slice(0, at);
      const domain = value.slice(at + 1);
      if (local.length >= 2) return `${local[0]}${BULLET.repeat(3)}@${domain}`;
      if (local.length === 1) return `${BULLET.repeat(3)}@${domain}`;
      return FULL;
    }
    case "name": {
      // First name + last name's initial ("Jane S."); a single-word name shows only its initial.
      const parts = value.trim().split(/\s+/).filter(Boolean);
      const first = parts[0];
      const last = parts.at(-1);
      if (!first || !last) return FULL;
      if (parts.length === 1) return `${[...first][0]}${BULLET.repeat(3)}`;
      return `${first} ${[...last][0]}.`;
    }
  }
}

/**
 * Masks the policy fields of `record` in a shallow copy; never mutates the input.
 * Takes no actor or role on purpose: masking always applies, there is no bypass.
 * Fails closed on nested values: an object or array field that isn't a policy field
 * is a compile-time error (`NestedKeys<T>` resolves to `never`) and a runtime
 * ValidationError — mask nested records separately and combine them. Date fields
 * pass through; they serialize as ISO strings.
 */
export function mask<T extends object, const P extends readonly MaskPolicy<StringField<T>>[]>(
  record: T & { [K in NestedKeys<T>]: never },
  policies: P,
): Masked<T, P[number]["field"]> {
  const policyFields = new Set<string>(policies.map((p) => p.field));
  for (const [key, value] of Object.entries(record)) {
    if (policyFields.has(key)) continue;
    if (value === null || typeof value !== "object" || value instanceof Date) continue;
    throw new ValidationError(`mask: field ${key} holds a nested value; mask it as its own record`);
  }
  const out = { ...record } as Record<string, unknown>;
  for (const policy of policies) {
    const value = out[policy.field];
    if (value === null || value === undefined) continue;
    out[policy.field] = typeof value === "string" ? maskValue(value, policy.style) : FULL;
  }
  return out as Masked<T, P[number]["field"]>;
}

export interface MaskedEntity<T> {
  entityType: string;
  policies: readonly MaskPolicy<StringField<T>>[];
  load: (tx: Tx, id: string) => Promise<T | null>;
}

/** Declares a masked entity next to the app that owns it. */
export function defineMaskedEntity<T>(def: MaskedEntity<T>): MaskedEntity<T> {
  return def;
}

/**
 * Returns the raw value of one masked field. Requires the policy's unmask
 * permission and a non-empty reason; writes a `field.unmask` audit row in the
 * same transaction as the read. The value is never written to the audit row.
 */
export async function unmask<T>(
  db: Db,
  actor: SessionUser,
  entity: MaskedEntity<T>,
  input: { entityId: string; field: string; reason: string },
): Promise<string | null> {
  const policy = entity.policies.find((p) => p.field === input.field);
  if (!policy) {
    throw new ValidationError(`no mask policy for field ${input.field} on ${entity.entityType}`);
  }
  await requirePermission(
    { db, user: actor, resource: `unmask:${entity.entityType}:${input.entityId}:${input.field}` },
    policy.unmaskPermission,
  );
  const reason = input.reason.trim();
  if (!reason) throw new ValidationError("unmasking requires a reason");
  return withAudit(
    db,
    {
      actor: { id: actor.id, subject: actor.subject },
      action: "field.unmask",
      entityType: entity.entityType,
      entityId: input.entityId,
      reason,
      metadata: { field: input.field },
    },
    async (tx) => {
      const record = await entity.load(tx, input.entityId);
      if (!record) throw new NotFoundError(`${entity.entityType} ${input.entityId} not found`);
      return (record[input.field as keyof T] as string | null | undefined) ?? null;
    },
  );
}
