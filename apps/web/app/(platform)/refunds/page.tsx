import Link from "next/link";
import { ListView, PageHeader, linkClass, type ListColumn } from "@fit/ui";
import { getDb, requirePagePermission } from "../../../lib/auth.ts";
import { formatPence, formatWhen } from "./format.ts";
import { searchPayments, type PaymentListItem } from "./refunds.ts";

const PAGE_SIZE = 20;
const SORTS = ["reference", "capturedAt", "customerName", "merchant", "amountPence", "availablePence"];

const columns: ListColumn<PaymentListItem>[] = [
  {
    key: "reference",
    label: "Payment",
    sortable: true,
    render: (p) => (
      <Link className={linkClass} href={`/refunds/payments/${p.id}`}>
        {p.reference}
      </Link>
    ),
  },
  { key: "capturedAt", label: "Captured", sortable: true, render: (p) => formatWhen(p.capturedAt) },
  { key: "customerName", label: "Customer", sortable: true, render: (p) => p.customerName },
  { key: "merchant", label: "Merchant", sortable: true, render: (p) => p.merchant },
  { key: "card", label: "Card", render: (p) => `${p.cardBrand} •••• ${p.cardLast4}` },
  { key: "amountPence", label: "Amount", sortable: true, render: (p) => formatPence(p.amountPence) },
  { key: "refundedPence", label: "Refunded", render: (p) => formatPence(p.refundedPence) },
  { key: "availablePence", label: "Refundable", sortable: true, render: (p) => formatPence(p.availablePence) },
];

export default async function RefundsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; sort?: string; dir?: string }>;
}) {
  await requirePagePermission("refunds:read", "/refunds");
  const params = await searchParams;
  const query = {
    search: params.q,
    sort: params.sort && SORTS.includes(params.sort) ? params.sort : undefined,
    dir: params.dir === "asc" ? ("asc" as const) : ("desc" as const),
    page: Math.max(1, Number(params.page) || 1),
  };
  const { rows, total } = await searchPayments(getDb(), { ...query, pageSize: PAGE_SIZE });
  return (
    <div className="stack">
      <PageHeader title="Refunds" description="Find a payment by reference, customer, merchant or card last four, then open it to request a refund." />
      <ListView
        label="Payments"
        basePath="/refunds"
        columns={columns}
        rows={rows}
        rowKey={(p) => p.id}
        query={query}
        pageSize={PAGE_SIZE}
        total={total}
        emptyTitle="No payments match"
      />
    </div>
  );
}
