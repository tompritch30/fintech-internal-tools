import Link from "next/link";
import { Badge, ListView, type ListColumn } from "@fit/ui";
import { getDb, requirePagePermission } from "../../../lib/auth.ts";
import { RISK, STATUS, formatWhen } from "./format.ts";
import { KYC_STATUSES, listKycCases, loadKycConfig, type KycCaseListItem, type KycStatus } from "./kyc.ts";

const PAGE_SIZE = 20;
const SORTS = ["reference", "riskRating", "status", "openedAt"];

const columns: ListColumn<KycCaseListItem>[] = [
  {
    key: "reference",
    label: "Case",
    sortable: true,
    render: (c) => (
      <Link className="font-medium underline-offset-4 hover:underline" href={`/kyc/cases/${c.id}`}>
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
        <Badge tone={c.highRisk ? "danger" : "neutral"}>{RISK[c.riskRating] ?? c.riskRating}</Badge>
        {c.sanctionsHit ? <Badge tone="danger">Sanctions</Badge> : null}
        {c.pep ? <Badge tone="warning">PEP</Badge> : null}
      </span>
    ),
  },
  {
    key: "status",
    label: "Status",
    sortable: true,
    render: (c) => <Badge tone={STATUS[c.status]?.tone ?? "neutral"}>{STATUS[c.status]?.label ?? c.status}</Badge>,
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
    page: Math.max(1, Number(params.page) || 1),
  };
  const { rows, total } = await listKycCases({ db: getDb(), user }, { ...query, status, pageSize: PAGE_SIZE });
  const filters = [{ value: undefined, label: "All" }, ...KYC_STATUSES.map((s) => ({ value: s, label: STATUS[s]?.label ?? s }))];
  return (
    <div className="stack">
      <h1 className="page-title">KYC review queue</h1>
      <p>Claim a case to review it. Applicant details are masked; high-risk approvals need a second person&apos;s sign-off.</p>
      <nav aria-label="Filter by status" className="flex flex-wrap gap-2 text-sm">
        {filters.map((f) => (
          <Link
            key={f.label}
            href={f.value ? `/kyc/status/${f.value}` : "/kyc"}
            aria-current={f.value === status ? "page" : undefined}
            className={`rounded-md border px-2 py-1 ${f.value === status ? "bg-muted font-medium" : ""}`}
          >
            {f.label}
          </Link>
        ))}
      </nav>
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
