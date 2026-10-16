import Link from "next/link";
import { ListView, StatusBadge, type ListColumn } from "@fit/ui";
import { getDb, requirePagePermission } from "../../../lib/auth.ts";
import { ENVIRONMENTS, listFlags, type FlagListItem, type FlagValue } from "./flags.ts";
import { describeFlagValue } from "./format.ts";
import { parsePageParam } from "../../../lib/page-param.ts";

const PAGE_SIZE = 20;

const valueBadge = (v: FlagValue) => <StatusBadge label={describeFlagValue(v)} />;

const columns: ListColumn<FlagListItem>[] = [
  {
    key: "key",
    label: "Flag",
    render: (f) => (
      <Link className="font-medium underline-offset-4 hover:underline" href={`/flags/${f.id}`}>
        {f.key}
      </Link>
    ),
  },
  { key: "description", label: "Description", render: (f) => f.description },
  ...ENVIRONMENTS.map((env) => ({ key: env, label: env, render: (f: FlagListItem) => valueBadge(f.values[env]) })),
  { key: "pending", label: "Prod change", render: (f) => (f.hasPendingChange ? <StatusBadge label="Awaiting approval" /> : "—") },
];

export default async function FlagsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  await requirePagePermission("flags:read", "/flags");
  const params = await searchParams;
  const query = { search: params.q, page: parsePageParam(params.page) };
  const all = await listFlags(getDb(), { q: query.search });
  const rows = all.slice((query.page - 1) * PAGE_SIZE, query.page * PAGE_SIZE);
  return (
    <div className="stack">
      <h1 className="page-title">Feature flags</h1>
      <p>
        Each flag has a value in dev, staging and prod. Dev and staging change at once; turning a flag on or changing it in prod
        needs a second person; turning it off in prod is immediate.
      </p>
      <ListView
        label="Feature flags"
        basePath="/flags"
        columns={columns}
        rows={rows}
        rowKey={(f) => f.id}
        query={query}
        pageSize={PAGE_SIZE}
        total={all.length}
        emptyTitle="No flags match"
      />
    </div>
  );
}
