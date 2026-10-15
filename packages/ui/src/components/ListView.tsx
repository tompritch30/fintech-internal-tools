import type { ReactNode } from "react";
import { buttonClass } from "./Button.tsx";
import { EmptyState } from "./EmptyState.tsx";
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
  emptyTitle?: string;
}) {
  const href = (patch: Partial<ListQuery>) => {
    const next = { ...query, ...patch };
    const params = new URLSearchParams();
    if (next.search) params.set("q", next.search);
    if (next.sort) params.set("sort", next.sort);
    if (next.sort && next.dir) params.set("dir", next.dir);
    if (next.page > 1) params.set("page", String(next.page));
    const qs = params.toString();
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

  return (
    <section aria-label={label}>
      <form className="fit-listview__toolbar" method="get" action={basePath} role="search">
        <label htmlFor={`${basePath}-search`} className="fit-visually-hidden">
          Search {label}
        </label>
        <input id={`${basePath}-search`} className="fit-input" type="search" name="q" defaultValue={query.search} placeholder="Search" />
        {query.sort ? <input type="hidden" name="sort" value={query.sort} /> : null}
        {query.sort && query.dir ? <input type="hidden" name="dir" value={query.dir} /> : null}
        <button type="submit" className={buttonClass()}>
          Search
        </button>
      </form>
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
                  header: <span className="fit-visually-hidden">Select</span>,
                  cell: (row) => (
                    <input
                      type="checkbox"
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
      <nav className="fit-listview__pager" aria-label={`${label} pages`}>
        <span>
          Page {query.page} of {pages} ({total} total)
        </span>
        {query.page > 1 ? (
          <a className={buttonClass()} href={href({ page: query.page - 1 })}>
            Previous
          </a>
        ) : null}
        {query.page < pages ? (
          <a className={buttonClass()} href={href({ page: query.page + 1 })}>
            Next
          </a>
        ) : null}
      </nav>
    </section>
  );
}
