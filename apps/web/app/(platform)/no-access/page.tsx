import { EmptyState } from "@fit/ui";
import { requireUser } from "../../../lib/auth.ts";
import { noAccessMessage } from "../../../lib/no-access.ts";

export default async function NoAccessPage() {
  const { title, body } = noAccessMessage(await requireUser());
  return (
    <EmptyState title={title}>
      <p>{body}</p>
    </EmptyState>
  );
}
