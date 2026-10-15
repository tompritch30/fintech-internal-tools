import "server-only";
import type { Db, Tx } from "@fit/db";
import type { Permission } from "../rbac/permissions.ts";
import type { SessionUser } from "../session/session.ts";

export type MaskStyle = "last4" | "full" | "email";

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
  [K in keyof T]: K extends F
    ? null extends T[K]
      ? MaskedValue | null
      : undefined extends T[K]
        ? MaskedValue | undefined
        : MaskedValue
    : T[K];
} & { readonly [maskedBrand]: "Masked" };

/**
 * Masks the policy fields of `record` in a shallow copy; never mutates the input.
 * Takes no actor or role on purpose: masking always applies, there is no bypass.
 */
export function mask<T extends object, const P extends readonly MaskPolicy<StringField<T>>[]>(
  _record: T,
  _policies: P,
): Masked<T, P[number]["field"]> {
  throw new Error("not implemented");
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
  _db: Db,
  _actor: SessionUser,
  _entity: MaskedEntity<T>,
  _input: { entityId: string; field: string; reason: string },
): Promise<string | null> {
  throw new Error("not implemented");
}
