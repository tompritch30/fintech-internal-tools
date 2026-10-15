import Link from "next/link";
import { ListView, PageHeader, StatusBadge, Tabs, linkClass, type ListColumn } from "@fit/ui";
import { getDb, requirePagePermission } from "../../../lib/auth.ts";
import { STATUS, formatWhen, riskBadges, statusOf } from "./format.ts";
import { KYC_STATUSES, listKycCases, loadKycConfig, type KycCaseListItem, type KycStatus } from "./kyc.ts";
import { parsePageParam } from "../../../lib/page-param.ts";

const PAGE_SIZE = 20;
const SORTS = ["reference", "riskRating", "status", "openedAt"];

const columns: ListColumn<KycCaseListItem>[] = [
  {
    key: "reference",
    label: "Case",
    sortable: true,
    render: (c) => (
      <Link className={linkClass} href={`/kyc/cases/${c.id}`}>
        {c.reference}
      </Link>
    ),
  },
  { key: "applicantName", label: "Applicant", render: (c) => c.applicantName },
  { key: "nationality", label: "Nationality", render: (c) => c.nationality },
  {
    key: "riskRating",
    label: "Risk",
    sortable: true,
    render: (c) => (
      <span className="flex flex-wrap gap-1">
        {riskBadges(c).map((b) => (
          <StatusBadge key={b.label} {...b} />
        ))}
      </span>
    ),
  },
  {
    key: "status",
    label: "Status",
    sortable: true,
    render: (c) => <StatusBadge {...statusOf(c.status)} />,
  },
  { key: "ownerName", label: "Owner", render: (c) => c.ownerName ?? "—" },
  { key: "openedAt", label: "Opened", sortable: true, render: (c) => formatWhen(c.openedAt) },
];

export type QueueSearchParams = Promise<{ q?: string; page?: string; sort?: string; dir?: string }>;

/** Queue for `/kyc` (all) and `/kyc/status/<status>`. The status is a path segment so ListView's links keep it. */
export async function KycQueue({ status, searchParams }: { status?: KycStatus; searchParams: QueueSearchParams }) {
  const basePath = status ? `/kyc/status/${status}` : "/kyc";
  const user = await requirePagePermission("kyc:read", basePath);
  loadKycConfig(); // a bad KYC_RETENTION_YEARS shows here, not after an analyst has claimed a case
  const params = await searchParams;
  const query = {
    search: params.q,
    sort: params.sort && SORTS.includes(params.sort) ? params.sort : undefined,
    dir: params.dir === "desc" ? ("desc" as const) : ("asc" as const),
    page: parsePageParam(params.page),
  };
  const { rows, total } = await listKycCases({ db: getDb(), user }, { ...query, status, pageSize: PAGE_SIZE });
  const filters = [{ value: undefined, label: "All" }, ...KYC_STATUSES.map((s) => ({ value: s, label: STATUS[s]?.label ?? s }))];
  return (
    <div className="stack">
      <PageHeader
        title="KYC review queue"
        description="Claim a case to review it. Applicant details are masked; high-risk approvals need a second person's sign-off."
      />
      <Tabs
        label="Filter by status"
        items={filters.map((f) => ({ href: f.value ? `/kyc/status/${f.value}` : "/kyc", label: f.label, current: f.value === status }))}
      />
      <ListView
        label="KYC cases"
        basePath={basePath}
        columns={columns}
        rows={rows}
        rowKey={(c) => c.id}
        query={query}
        pageSize={PAGE_SIZE}
        total={total}
        emptyTitle="No cases match"
      />
    </div>
  );
}
