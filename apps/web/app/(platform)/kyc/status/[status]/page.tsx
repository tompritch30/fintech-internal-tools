import { notFound } from "next/navigation";
import { KycQueue, type QueueSearchParams } from "../../queue.tsx";
import { KYC_STATUSES } from "../../kyc.ts";

export default async function KycStatusQueuePage({
  params,
  searchParams,
}: {
  params: Promise<{ status: string }>;
  searchParams: QueueSearchParams;
}) {
  const { status } = await params;
  const known = KYC_STATUSES.find((s) => s === status);
  if (!known) notFound();
  return <KycQueue status={known} searchParams={searchParams} />;
}
