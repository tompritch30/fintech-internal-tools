import Link from "next/link";
import { FilterBar, ListView, PageHeader, StatusBadge, linkClass, type ListColumn } from "@fit/ui";
import { getDb, requirePagePermission } from "../../../lib/auth.ts";
import { auditFilterOptions, first, parseAuditFilters, searchAudit, type AuditFilters, type AuditRow, type SearchParam } from "./query.ts";
import { parsePageParam } from "../../../lib/page-param.ts";

const PAGE_SIZE = 25;

function RecordCell({ row }: { row: AuditRow }) {
  const raw = `${row.entityType} ${row.entityId}`;
  if (!row.recordLabel) return <>{raw}</>;
  return row.recordHref ? (
    <Link href={row.recordHref} className={linkClass} title={raw}>
      {row.recordLabel}
    </Link>
  ) : (
    <span title={raw}>{row.recordLabel}</span>
  );
}

function exportHref(filters: AuditFilters): string {
  const qs = new URLSearchParams(Object.entries(filters).filter((e): e is [string, string] => Boolean(e[1]))).toString();
  return qs ? `/audit/export?${qs}` : "/audit/export";
}

const columns: ListColumn<AuditRow>[] = [
  { key: "occurredAt", label: "When (UTC)", sortable: true, render: (r) => r.occurredAt.toISOString().replace("T", " ").slice(0, 19) },
  { key: "actor", label: "Who", render: (r) => <span title={r.actorUsername ?? undefined}>{r.actorName ?? "system"}</span> },
  { key: "action", label: "Action", render: (r) => <StatusBadge label={r.action} /> },
  { key: "entity", label: "Record", render: (r) => <RecordCell row={r} /> },
  { key: "reason", label: "Reason", render: (r) => r.reason ?? "" },
];

const opts = (values: string[]) => values.map((v) => ({ value: v, label: v }));

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, SearchParam>> }) {
  await requirePagePermission("audit:read", "/audit");
  const params = await searchParams;
  const filters = parseAuditFilters(params);
  const query = {
    sort: params.sort === "occurredAt" ? "occurredAt" : undefined,
    dir: params.dir === "asc" ? ("asc" as const) : ("desc" as const),
    page: parsePageParam(first(params.page)),
  };
  const db = getDb();
  const [{ rows, total }, options] = await Promise.all([
    searchAudit(db, filters, { page: query.page, pageSize: PAGE_SIZE, dir: query.dir }),
    auditFilterOptions(db),
  ]);
  const values: Record<string, string | undefined> = { ...filters };

  return (
    <div className="stack">
      <PageHeader title="Audit log" description="Read-only. Rows cannot be edited or deleted. Dates are UTC and include both ends." />
      <FilterBar
        label="Audit filters"
        basePath="/audit"
        values={values}
        fields={[
          { name: "from", label: "From", type: "date" },
          { name: "to", label: "To", type: "date" },
          { name: "user", label: "User", type: "select", options: options.users },
          { name: "action", label: "Action", type: "select", options: opts(options.actions) },
          { name: "recordType", label: "Record type", type: "select", options: opts(options.recordTypes) },
          { name: "recordId", label: "Record ID", type: "text", placeholder: "PAY-, KYC-, flag key or ID" },
        ]}
      />
      <p className="flex justify-end text-sm">
        <a href={exportHref(filters)} className={linkClass} download>
          Export CSV of these {total} rows
        </a>
      </p>
      <ListView
        label="Audit log"
        basePath="/audit"
        search={false}
        params={values}
        columns={columns}
        rows={rows}
        rowKey={(r) => String(r.id)}
        query={query}
        pageSize={PAGE_SIZE}
        total={total}
        emptyTitle="No audit rows match these filters"
      />
    </div>
  );
}
