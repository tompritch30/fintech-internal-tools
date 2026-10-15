import Link from "next/link";
import { Banknote, IdCard, ScrollText, SquareKanban } from "lucide-react";
import { AppTile, EmptyState, PageHeader, RecordSection, StatusBadge, Table, TileGrid, linkClass, type Column } from "@fit/ui";
import { getDb, requirePagePermission } from "../../lib/auth.ts";
import { awaitingMyApproval, claimableKycCases, myRecentActivity, type ActivityItem, type AwaitingItem } from "./dashboard.ts";

const when = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;

const awaitingColumns: Column<AwaitingItem>[] = [
  { key: "kind", label: "Type", render: (r) => <StatusBadge label={r.kind} /> },
  {
    key: "title",
    label: "Record",
    render: (r) => (
      <Link className={linkClass} href={r.href}>
        {r.title}
      </Link>
    ),
  },
  { key: "requestedBy", label: "Requested by", render: (r) => r.requestedByName },
  { key: "requestedAt", label: "Waiting since", render: (r) => when(r.requestedAt) },
];

const activityColumns: Column<ActivityItem>[] = [
  { key: "occurredAt", label: "When", render: (r) => when(r.occurredAt) },
  { key: "action", label: "Action", render: (r) => <StatusBadge label={r.action} /> },
  {
    key: "record",
    label: "Record",
    render: (r) =>
      r.href ? (
        <Link className={linkClass} href={r.href}>
          {r.record}
        </Link>
      ) : (
        r.record
      ),
  },
];

export default async function HomePage() {
  const user = await requirePagePermission("platform:access", "/");
  const db = getDb();
  const can = (p: "refunds:read" | "refunds:approve" | "kyc:read" | "kyc:approve" | "audit:read") => user.permissions.has(p);
  const approves = can("refunds:approve") || can("kyc:approve");
  const [awaiting, activity, claimable] = await Promise.all([
    approves ? awaitingMyApproval(db, user) : Promise.resolve(null),
    myRecentActivity(db, user),
    can("kyc:read") ? claimableKycCases(db) : Promise.resolve(null),
  ]);

  return (
    <div className="stack">
      <PageHeader
        title={`Welcome, ${user.displayName ?? user.username}`}
        description={
          <>
            Signed in as <span data-testid="username">{user.username}</span>. Your roles are in the account menu.
          </>
        }
      />
      <TileGrid label="Apps">
        {can("refunds:read") ? (
          <AppTile
            href={can("refunds:approve") ? "/refunds/approvals" : "/refunds"}
            icon={<Banknote />}
            title="Refunds"
            description="Find a payment and request or approve a refund."
            stat={awaiting && can("refunds:approve") ? `${awaiting.items.filter((i) => i.kind === "Refund").length} waiting for you` : undefined}
          />
        ) : null}
        {can("kyc:read") ? (
          <AppTile href="/kyc" icon={<IdCard />} title="KYC review" description="Claim and decide customer due-diligence cases." stat={claimable !== null ? `${claimable} open to claim` : undefined} />
        ) : null}
        {can("audit:read") ? <AppTile href="/audit" icon={<ScrollText />} title="Audit log" description="Who did what, when and why. Read-only." /> : null}
        <AppTile href="/demo-record" icon={<SquareKanban />} title="Demo record" description="The shared record layout, for reference." />
      </TileGrid>
      {awaiting ? (
        <RecordSection title="Waiting for your approval">
          {awaiting.items.length === 0 ? (
            <EmptyState title="Nothing is waiting for you" />
          ) : (
            <>
              <Table caption="Waiting for your approval" columns={awaitingColumns} rows={awaiting.items} rowKey={(r) => r.id} />
              {awaiting.total > awaiting.items.length ? (
                <p className="text-sm text-muted-foreground">
                  Showing the oldest {awaiting.items.length} of {awaiting.total}.
                </p>
              ) : null}
            </>
          )}
        </RecordSection>
      ) : null}
      <RecordSection title="Your recent activity">
        {activity.length === 0 ? (
          <EmptyState title="No activity yet" />
        ) : (
          <Table caption="Your recent activity" columns={activityColumns} rows={activity} rowKey={(r) => String(r.id)} />
        )}
      </RecordSection>
    </div>
  );
}
