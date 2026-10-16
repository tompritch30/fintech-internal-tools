import { ForbiddenError } from "@fit/core";
import { getCurrentUser, getDb } from "../../../../lib/auth.ts";
import { exportAudit, parseAuditFilters } from "../query.ts";

const seeOther = (location: string) => new Response(null, { status: 303, headers: { location } });

/** CSV of the audit log view with the same filters. Needs `audit:read`; each export is audited. */
export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return seeOther("/login");
  const filters = parseAuditFilters(Object.fromEntries(new URL(request.url).searchParams));
  try {
    const { csv } = await exportAudit({ db: getDb(), user }, filters);
    const day = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="audit-log-${day}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof ForbiddenError) return seeOther("/no-access");
    throw err;
  }
}
