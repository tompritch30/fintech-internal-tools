import { describe, expect, expectTypeOf, it } from "vitest";
import { mask, type Masked, type MaskedValue, type MaskPolicy } from "../src/masking/masking.ts";

interface Row {
  id: string;
  email: string | null;
  balance: number;
}

const policies = [
  { field: "email", style: "email", unmaskPermission: "pii:unmask" },
] as const satisfies readonly MaskPolicy<"email">[];

describe("Masked<T> types", () => {
  it("a raw record is not assignable to Masked<T>", () => {
    const raw: Row = { id: "1", email: "a@example.test", balance: 10 };
    // @ts-expect-error a raw record lacks the mask brand
    const masked: Masked<Row, "email"> = raw;
    // @ts-expect-error a plain string lacks the mask brand
    const value: MaskedValue = "secret";
    expect(masked).toBe(raw);
    expect(value).toBe("secret");
  });

  it("mask() output is assignable to Masked<T>", () => {
    const raw: Row = { id: "1", email: "a@example.test", balance: 10 };
    const masked = mask(raw, policies);
    const typed: Masked<Row, "email"> = masked;
    expectTypeOf(masked.email).toEqualTypeOf<MaskedValue | null>();
    expectTypeOf(masked.balance).toEqualTypeOf<number>();
    expect(typed).toBe(masked);
  });

  it("mask() does not compile for a record with a nested object or unknown field", () => {
    // Dead closure: the calls must type-check (or not), never run.
    const compileCheck = () => {
      // @ts-expect-error nested objects must be masked as their own records
      mask({ id: "1", email: "a@example.test", address: { line1: "1 Test Street" } }, policies);
      // @ts-expect-error `unknown` could hide a nested object
      mask({ id: "1", email: "a@example.test", meta: {} as unknown }, policies);
    };
    expect(compileCheck).toBeTypeOf("function");
    // Control: Date fields are allowed — they serialize as ISO strings.
    const withDate = mask({ id: "1", email: "a@example.test", createdAt: new Date() }, policies);
    expect(withDate.createdAt).toBeInstanceOf(Date);
  });

  it("Masked<T> keeps undefined for optional masked fields", () => {
    const record: { id: string; f?: string | null; g: string; h: string | null; u: string | null | undefined } = {
      id: "1",
      f: "x@example.test",
      g: "y@example.test",
      h: "z@example.test",
      u: undefined,
    };
    const masked = mask(record, [
      { field: "f", style: "email", unmaskPermission: "pii:unmask" },
      { field: "g", style: "email", unmaskPermission: "pii:unmask" },
      { field: "h", style: "email", unmaskPermission: "pii:unmask" },
      { field: "u", style: "email", unmaskPermission: "pii:unmask" },
    ]);
    expectTypeOf(masked.f).toEqualTypeOf<MaskedValue | null | undefined>();
    expectTypeOf(masked.u).toEqualTypeOf<MaskedValue | null | undefined>();
    expectTypeOf(masked.g).toEqualTypeOf<MaskedValue>();
    expectTypeOf(masked.h).toEqualTypeOf<MaskedValue | null>();
  });
});
