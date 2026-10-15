import Link from "next/link";
import { ListView, PageHeader, linkClass, type ListColumn } from "@fit/ui";
import { getDb, requirePagePermission } from "../../../../lib/auth.ts";
import { formatPence, formatWhen } from "../format.ts";
import { listPendingRefundApprovals, type PendingApprovalItem } from "../refunds.ts";

const PAGE_SIZE = 20;
const SORTS = ["requestedAt", "amountPence", "paymentReference"];

const columns: ListColumn<PendingApprovalItem>[] = [
  { key: "requestedAt", label: "Requested", sortable: true, render: (r) => formatWhen(r.requestedAt) },
  { key: "paymentReference", label: "Payment", sortable: true, render: (r) => r.paymentReference },
  { key: "amountPence", label: "Amount", sortable: true, render: (r) => formatPence(r.amountPence) },
  { key: "reason", label: "Reason", render: (r) => r.reason },
  { key: "requestedBy", label: "Requested by", render: (r) => r.requestedByName },
  {
    key: "open",
    label: "",
    render: (r) => (
      <Link className={linkClass} href={`/refunds/requests/${r.refundId}`}>
        Review
      </Link>
    ),
  },
];

export default async function RefundApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; sort?: string; dir?: string }>;
}) {
  const user = await requirePagePermission("refunds:approve", "/refunds/approvals");
  const params = await searchParams;
  const query = {
    search: params.q,
    sort: params.sort && SORTS.includes(params.sort) ? params.sort : undefined,
    dir: params.dir === "desc" ? ("desc" as const) : ("asc" as const),
    page: Math.max(1, Number(params.page) || 1),
  };
  const { rows, total } = await listPendingRefundApprovals({ db: getDb(), user }, { ...query, pageSize: PAGE_SIZE });
  return (
    <div className="stack">
      <PageHeader title="Refund approvals" description="Refunds over the approval threshold, oldest first. You cannot approve a refund you requested." />
      <ListView
        label="Pending refund approvals"
        basePath="/refunds/approvals"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.refundId}
        query={query}
        pageSize={PAGE_SIZE}
        total={total}
        emptyTitle="No refunds are waiting for approval"
      />
    </div>
  );
}
