import { describe, expect, it } from "vitest";
import { noAccessMessage } from "../lib/no-access.ts";

const user = (roles: string[], displayName: string | null = "Nia New") => ({ username: "nia", displayName, roles });

describe("no-access page wording", () => {
  it("welcomes a user with no roles yet instead of calling it a denied page", () => {
    const m = noAccessMessage(user([]));
    expect(m.title).toBe("Welcome, Nia New");
    expect(m.body).toContain("doesn't have any roles yet");
    expect(m.body).not.toContain("recorded");
  });

  it("tells a user with roles they can't open this page, and that the attempt was recorded", () => {
    const m = noAccessMessage(user(["analyst"]));
    expect(m.title).toBe("You don't have access to this page");
    expect(m.body).toContain("Signed in as Nia New");
    expect(m.body).toContain("This attempt has been recorded.");
  });

  it("never names Entra ID while sign-in is Keycloak", () => {
    for (const m of [noAccessMessage(user([])), noAccessMessage(user(["analyst"], null))]) {
      expect(`${m.title} ${m.body}`).not.toMatch(/entra/i);
    }
  });

  it("falls back to the username when there's no display name", () => {
    expect(noAccessMessage(user([], null)).title).toBe("Welcome, nia");
  });
});
