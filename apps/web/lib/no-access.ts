/** Wording for /no-access: a first landing for users with no roles yet, a denial for everyone else. */
export function noAccessMessage(user: { username: string; displayName: string | null; roles: string[] }): { title: string; body: string } {
  const name = user.displayName ?? user.username;
  if (user.roles.length === 0) {
    return {
      title: `Welcome, ${name}`,
      body: "Your account doesn't have any roles yet, so there's nothing to open here. Ask your manager to request the role you need. Once it's granted, sign out and sign back in.",
    };
  }
  return {
    title: "You don't have access to this page",
    body: `Signed in as ${name}. If you need it, ask your manager to request the right role for you. This attempt has been recorded.`,
  };
}
