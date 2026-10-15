import type { AuditListItem } from "@fit/core";
import { FilterBar, ListView, PageHeader, StatusBadge, type ListColumn } from "@fit/ui";
import { getDb, requirePagePermission } from "../../../lib/auth.ts";
import { auditFilterOptions, parseAuditFilters, searchAudit } from "./query.ts";

const PAGE_SIZE = 25;

const columns: ListColumn<AuditListItem>[] = [
  { key: "occurredAt", label: "When (UTC)", sortable: true, render: (r) => r.occurredAt.toISOString().replace("T", " ").slice(0, 19) },
  { key: "actor", label: "Who", render: (r) => r.actor ?? "system" },
  { key: "action", label: "Action", render: (r) => <StatusBadge label={r.action} /> },
  { key: "entity", label: "Record", render: (r) => `${r.entityType} ${r.entityId}` },
  { key: "reason", label: "Reason", render: (r) => r.reason ?? "" },
];

const opts = (values: string[]) => values.map((v) => ({ value: v, label: v }));

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePagePermission("audit:read", "/audit");
  const params = await searchParams;
  const filters = parseAuditFilters(params);
  const query = {
    sort: params.sort === "occurredAt" ? "occurredAt" : undefined,
    dir: params.dir === "asc" ? ("asc" as const) : ("desc" as const),
    page: Math.max(1, Number(params.page) || 1),
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
          { name: "user", label: "User", type: "select", options: opts(options.users) },
          { name: "action", label: "Action", type: "select", options: opts(options.actions) },
          { name: "recordType", label: "Record type", type: "select", options: opts(options.recordTypes) },
          { name: "recordId", label: "Record ID", type: "text", placeholder: "ID or its start" },
        ]}
      />
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
