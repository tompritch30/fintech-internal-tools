import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { mockProviderRefunds, type Tx } from "@fit/db";

export interface ProviderRefund {
  id: string;
  refundId: string;
  amountPence: number;
}

/**
 * Stand-in for the card provider's refund API. Idempotent on our refund id, like a
 * real provider's idempotency key: a second call for the same refund returns the
 * first result and moves no money. Runs in the caller's transaction.
 */
export async function issueProviderRefund(
  tx: Tx,
  input: { refundId: string; paymentReference: string; amountPence: number },
): Promise<ProviderRefund> {
  const [created] = await tx
    .insert(mockProviderRefunds)
    .values({ id: `mpr_${randomUUID().replaceAll("-", "").slice(0, 20)}`, ...input })
    .onConflictDoNothing({ target: mockProviderRefunds.refundId })
    .returning();
  const row =
    created ?? (await tx.select().from(mockProviderRefunds).where(eq(mockProviderRefunds.refundId, input.refundId)))[0];
  if (!row) throw new Error(`provider refund for ${input.refundId} not found`);
  return { id: row.id, refundId: row.refundId, amountPence: row.amountPence };
}
