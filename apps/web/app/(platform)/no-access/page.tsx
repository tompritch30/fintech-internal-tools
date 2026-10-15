import { EmptyState } from "@fit/ui";
import { requireUser } from "../../../lib/auth.ts";

export default async function NoAccessPage() {
  const user = await requireUser();
  return (
    <EmptyState title="You don't have access to this page">
      <p>
        Signed in as {user.username}. Ask your manager to request the right role in Entra ID. This attempt has been
        recorded.
      </p>
    </EmptyState>
  );
}
