import Link from "next/link";
import { ListView, type ListColumn } from "@fit/ui";
import { getDb, requirePagePermission } from "../../../../lib/auth.ts";
import { listPendingFlagChanges, type FlagChangeView } from "../flags.ts";
import { describeFlagValue, formatWhen } from "../format.ts";
import { parsePageParam } from "../../../../lib/page-param.ts";

const PAGE_SIZE = 20;

const columns: ListColumn<FlagChangeView>[] = [
  { key: "requestedAt", label: "Requested", render: (c) => formatWhen(c.requestedAt) },
  { key: "flagKey", label: "Flag", render: (c) => c.flagKey },
  { key: "change", label: "Prod change", render: (c) => `${describeFlagValue(c.before)} → ${describeFlagValue(c.after)}` },
  { key: "reason", label: "Reason", render: (c) => c.reason },
  { key: "requestedBy", label: "Requested by", render: (c) => c.requestedByName },
  {
    key: "open",
    label: "",
    render: (c) => (
      <Link className="font-medium underline-offset-4 hover:underline" href={`/flags/${c.flagId}`}>
        Review
      </Link>
    ),
  },
];

export default async function FlagApprovalsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const user = await requirePagePermission("flags:approve", "/flags/approvals");
  const params = await searchParams;
  const query = { search: params.q, page: parsePageParam(params.page) };
  const all = await listPendingFlagChanges({ db: getDb(), user }, { q: query.search });
  return (
    <div className="stack">
      <h1 className="page-title">Flag approvals</h1>
      <p>Prod flag changes waiting for a second person, oldest first. You cannot approve a change you requested.</p>
      <ListView
        label="Pending prod flag changes"
        basePath="/flags/approvals"
        columns={columns}
        rows={all.slice((query.page - 1) * PAGE_SIZE, query.page * PAGE_SIZE)}
        rowKey={(c) => c.id}
        query={query}
        pageSize={PAGE_SIZE}
        total={all.length}
        emptyTitle={query.search ? "No pending prod changes match" : "No prod flag changes are waiting for approval"}
      />
    </div>
  );
}
