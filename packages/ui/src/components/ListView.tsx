import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { cn } from "../lib/cn.ts";
import { buttonClass } from "./Button.tsx";
import { EmptyState } from "./EmptyState.tsx";
import { inputClass } from "./Input.tsx";
import { Table, type Column } from "./Table.tsx";

export interface ListColumn<T> extends Omit<Column<T>, "headerHref" | "ariaSort"> {
  sortable?: boolean;
}

export interface ListQuery {
  search?: string;
  sort?: string;
  dir?: "asc" | "desc";
  page: number;
}

/**
 * Queue view: search, sortable columns, paging, optional row selection and a CommandBar slot.
 * State lives in the URL (GET form + links), so it works from server components with no client JS.
 * When `selection` is set, rows get checkboxes named `selection.name` bound to the form `selection.formId`,
 * so CommandBar buttons in that form submit the selected ids to a server action.
 * Pages with labelled filters (a FilterBar) set `search={false}` and pass the filter values as `params`
 * so sorting and paging links keep them.
 */
export function ListView<T>({
  label,
  basePath,
  columns,
  rows,
  rowKey,
  query,
  pageSize,
  total,
  commandBar,
  selection,
  search = true,
  params = {},
  emptyTitle = "Nothing to show",
}: {
  label: string;
  basePath: string;
  columns: ListColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  query: ListQuery;
  pageSize: number;
  total: number;
  commandBar?: ReactNode;
  selection?: { formId: string; name: string };
  search?: boolean;
  params?: Record<string, string | undefined>;
  emptyTitle?: string;
}) {
  const href = (patch: Partial<ListQuery>) => {
    const next = { ...query, ...patch };
    const qp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) qp.set(k, v);
    if (next.search) qp.set("q", next.search);
    if (next.sort) qp.set("sort", next.sort);
    if (next.sort && next.dir) qp.set("dir", next.dir);
    if (next.page > 1) qp.set("page", String(next.page));
    const qs = qp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const tableColumns: Column<T>[] = columns.map(({ sortable, ...c }) => {
    if (!sortable) return c;
    const active = query.sort === c.key;
    const dir = active && query.dir === "asc" ? "desc" : "asc";
    return {
      ...c,
      headerHref: href({ sort: c.key, dir, page: 1 }),
      ariaSort: active ? (query.dir === "asc" ? "ascending" : "descending") : "none",
    };
  });

  const pagerButton = cn(buttonClass(), "h-8 gap-1 px-2.5");

  return (
    <section aria-label={label} className="flex flex-col gap-3">
      {search ? (
      <form className="flex items-center gap-2" method="get" action={basePath} role="search">
        <label htmlFor={`${basePath}-search`} className="sr-only">
          Search {label}
        </label>
        <div className="relative w-full max-w-xs">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            id={`${basePath}-search`}
            className={cn(inputClass, "pl-8")}
            type="search"
            name="q"
            defaultValue={query.search}
            placeholder="Search"
          />
        </div>
        {query.sort ? <input type="hidden" name="sort" value={query.sort} /> : null}
        {query.sort && query.dir ? <input type="hidden" name="dir" value={query.dir} /> : null}
        <button type="submit" className={buttonClass()}>
          Search
        </button>
      </form>
      ) : null}
      {commandBar}
      {rows.length === 0 ? (
        <EmptyState title={emptyTitle} />
      ) : (
        <Table
          caption={label}
          columns={tableColumns}
          rows={rows}
          rowKey={rowKey}
          leading={
            selection
              ? {
                  header: <span className="sr-only">Select</span>,
                  cell: (row) => (
                    <input
                      type="checkbox"
                      className="size-4 cursor-pointer rounded border-input accent-primary"
                      form={selection.formId}
                      name={selection.name}
                      value={rowKey(row)}
                      aria-label={`Select ${rowKey(row)}`}
                    />
                  ),
                }
              : undefined
          }
        />
      )}
      <nav className="flex items-center justify-between gap-2 text-sm text-muted-foreground" aria-label={`${label} pages`}>
        <span>
          Page {query.page} of {pages} ({total} total)
        </span>
        <div className="flex items-center gap-2">
          {query.page > 1 ? (
            <a className={pagerButton} href={href({ page: query.page - 1 })}>
              <ChevronLeft aria-hidden />
              Previous
            </a>
          ) : null}
          {query.page < pages ? (
            <a className={pagerButton} href={href({ page: query.page + 1 })}>
              Next
              <ChevronRight aria-hidden />
            </a>
          ) : null}
        </div>
      </nav>
    </section>
  );
}
