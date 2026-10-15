import { KycQueue, type QueueSearchParams } from "./queue.tsx";

export default function KycQueuePage({ searchParams }: { searchParams: QueueSearchParams }) {
  return <KycQueue searchParams={searchParams} />;
}
