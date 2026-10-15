import { describe, expect, expectTypeOf, it } from "vitest";
import { defineApprovalKind } from "../src/index.ts";

describe("approval payload types", () => {
  it("an approval kind with a non-JSON payload does not compile", () => {
    // Dead closure: the calls must type-check (or not), never run.
    const compileCheck = () => {
      // @ts-expect-error Date payloads can't round-trip through JSONB
      defineApprovalKind<{ at: Date }>({
        kind: "t.date",
        subjectType: "t",
        requestPermission: "approvals:request",
        approvePermission: "approvals:decide",
      });
      // @ts-expect-error bigint payloads can't round-trip through JSONB
      defineApprovalKind<{ n: bigint }>({
        kind: "t.bigint",
        subjectType: "t",
        requestPermission: "approvals:request",
        approvePermission: "approvals:decide",
      });
    };
    expect(compileCheck).toBeTypeOf("function");
  });

  it("an interface payload compiles and hooks see its type", () => {
    interface RefundPayload {
      amount: number;
      reason?: string;
      lines: { sku: string }[];
    }
    const kind = defineApprovalKind<RefundPayload>({
      kind: "t.refund",
      subjectType: "t",
      requestPermission: "approvals:request",
      approvePermission: "approvals:decide",
      onApproved: async (_tx, req) => {
        expectTypeOf(req.payload).toEqualTypeOf<RefundPayload>();
      },
    });
    expect(kind.kind).toBe("t.refund");
  });
});
