import { describe, expect, it } from "vitest";
import { sessionCookie } from "../src/session/cookie.ts";

describe("session cookie name and Secure flag follow APP_URL", () => {
  it("uses the __Host- prefix and Secure when APP_URL is https", () => {
    expect(sessionCookie("https://tools.example.test")).toEqual({ name: "__Host-fit_session", secure: true });
  });

  it("uses a plain name without Secure when APP_URL is local http", () => {
    expect(sessionCookie("http://localhost:3000")).toEqual({ name: "fit_session", secure: false });
  });

  it("keeps the __Host- prefix and Secure for http on a non-loopback host", () => {
    expect(sessionCookie("http://tools.example.test")).toEqual({ name: "__Host-fit_session", secure: true });
    expect(sessionCookie("http://10.0.0.5:3000")).toEqual({ name: "__Host-fit_session", secure: true });
  });

  it("uses the plain name on every loopback http host", () => {
    for (const url of ["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"]) {
      expect(sessionCookie(url)).toEqual({ name: "fit_session", secure: false });
    }
  });
});
