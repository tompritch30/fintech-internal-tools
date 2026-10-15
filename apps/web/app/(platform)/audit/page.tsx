import { listAudit, type AuditListItem } from "@fit/core";
import { Badge, ListView, type ListColumn } from "@fit/ui";
import { getDb, requirePagePermission } from "../../../lib/auth.ts";
import { parsePageParam } from "../../../lib/page-param.ts";

const PAGE_SIZE = 25;

const columns: ListColumn<AuditListItem>[] = [
  { key: "occurredAt", label: "When (UTC)", sortable: true, render: (r) => r.occurredAt.toISOString().replace("T", " ").slice(0, 19) },
  { key: "actor", label: "Who", render: (r) => r.actor ?? "system" },
  {
    key: "action",
    label: "Action",
    render: (r) => <Badge tone={r.action === "access.denied" ? "danger" : "neutral"}>{r.action}</Badge>,
  },
  { key: "entity", label: "Record", render: (r) => `${r.entityType} ${r.entityId}` },
  { key: "reason", label: "Reason", render: (r) => r.reason ?? "" },
];

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; sort?: string; dir?: string }>;
}) {
  await requirePagePermission("audit:read", "/audit");
  const params = await searchParams;
  const query = {
    search: params.q,
    sort: params.sort === "occurredAt" ? "occurredAt" : undefined,
    dir: params.dir === "asc" ? ("asc" as const) : ("desc" as const),
    page: parsePageParam(params.page),
  };
  const { rows, total } = await listAudit(getDb(), { search: query.search, page: query.page, pageSize: PAGE_SIZE, dir: query.dir });

  return (
    <div className="stack">
      <h1 className="page-title">Audit log</h1>
      <p>Read-only. Rows cannot be edited or deleted.</p>
      <ListView
        label="Audit log"
        basePath="/audit"
        columns={columns}
        rows={rows}
        rowKey={(r) => String(r.id)}
        query={query}
        pageSize={PAGE_SIZE}
        total={total}
        emptyTitle="No audit rows match"
      />
    </div>
  );
}
