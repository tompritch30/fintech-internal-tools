import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "@fit/core";
import { revealFailure } from "../lib/reveal-errors.ts";

describe("reveal errors read as sentences", () => {
  it("asks for a reason when none was given", () => {
    expect(revealFailure(new ValidationError("unmasking requires a reason"))).toEqual({ error: "Give a reason for revealing this." });
  });

  it("says how long the reason must be", () => {
    expect(revealFailure(new ValidationError("unmasking requires a reason of at least 10 characters"))).toEqual({
      error: "The reason must be at least 10 characters.",
    });
  });

  it("explains the hourly reveal limit rather than a generic permission error", () => {
    expect(revealFailure(new ForbiddenError("unmask:rate-limit"))).toEqual({ error: "You've reached the hourly limit for reveals. Try again later." });
    expect(revealFailure(new ForbiddenError("pii:unmask"))).toEqual({ error: "You don't have permission to reveal this." });
  });

  it("starts any other expected error with a capital and ends it with a full stop", () => {
    expect(revealFailure(new NotFoundError("payment abc not found"))).toEqual({ error: "Payment abc not found." });
  });

  it("rethrows anything unexpected", () => {
    expect(() => revealFailure(new Error("boom"))).toThrow("boom");
  });
});
