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
});
