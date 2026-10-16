import { describe, expect, it } from "vitest";
import { sessionCookie } from "../src/session/cookie.ts";

describe("session cookie name and Secure flag follow APP_URL", () => {
  it("uses the __Host- prefix and Secure when APP_URL is https", () => {
    expect(sessionCookie("https://tools.example.test")).toEqual({ name: "__Host-fit_session", secure: true });
  });

  it("uses a plain name without Secure when APP_URL is local http", () => {
    expect(sessionCookie("http://localhost:3000")).toEqual({ name: "fit_session", secure: false });
  });
});
