import { Badge } from "@fit/ui";
import { requirePagePermission } from "../../lib/auth.ts";

export default async function HomePage() {
  const user = await requirePagePermission("platform:access", "/");
  return (
    <div className="stack">
      <h1 className="page-title">Welcome, {user.displayName ?? user.username}</h1>
      <section aria-label="Your access">
        <p>
          Username: <strong data-testid="username">{user.username}</strong>
        </p>
        <p>
          Roles:{" "}
          {user.roles.map((r) => (
            <Badge key={r} tone="info">
              {r}
            </Badge>
          ))}
        </p>
        <p>Permissions: {[...user.permissions].sort().join(", ")}</p>
      </section>
    </div>
  );
}
