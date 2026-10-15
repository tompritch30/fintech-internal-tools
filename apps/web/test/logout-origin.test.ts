import { describe, expect, it } from "vitest";
import { isSameOrigin } from "../lib/same-origin.ts";

const APP_URL = "http://localhost:3000";
const headers = (h: Record<string, string>) => new Headers(h);

describe("logout only accepts same-origin POSTs", () => {
  it("accepts a POST from the app's own origin", () => {
    expect(isSameOrigin(headers({ origin: "http://localhost:3000" }), APP_URL)).toBe(true);
  });

  it("rejects a POST from another origin, including a same-site one", () => {
    expect(isSameOrigin(headers({ origin: "https://evil.example" }), APP_URL)).toBe(false);
    expect(isSameOrigin(headers({ origin: "http://localhost:3001" }), APP_URL)).toBe(false);
  });

  it("rejects a POST with no Origin header", () => {
    expect(isSameOrigin(headers({}), APP_URL)).toBe(false);
    expect(isSameOrigin(headers({ origin: "null" }), APP_URL)).toBe(false);
  });
});
