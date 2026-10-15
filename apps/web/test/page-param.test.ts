import { describe, expect, it } from "vitest";
import { MAX_PAGE, parsePageParam } from "../lib/page-param.ts";

describe("list pages only pass a safe page number to the database", () => {
  it("keeps a valid page number", () => {
    expect(parsePageParam("3")).toBe(3);
  });

  it("uses page 1 when the page is missing or not a positive number", () => {
    expect(parsePageParam(undefined)).toBe(1);
    expect(parsePageParam("abc")).toBe(1);
    expect(parsePageParam("0")).toBe(1);
    expect(parsePageParam("-4")).toBe(1);
  });

  it("uses page 1 for page=Infinity instead of an infinite offset", () => {
    expect(parsePageParam("Infinity")).toBe(1);
    expect(parsePageParam("-Infinity")).toBe(1);
  });

  it("rounds a fractional page down", () => {
    expect(parsePageParam("2.7")).toBe(2);
  });

  it("caps a huge page number so the offset stays in range", () => {
    expect(parsePageParam("1e300")).toBe(MAX_PAGE);
    expect(parsePageParam(String(Number.MAX_SAFE_INTEGER))).toBe(MAX_PAGE);
  });
});
