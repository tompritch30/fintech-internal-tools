import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";

export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  /** When set, the header becomes a link (used by ListView for sorting). */
  headerHref?: string;
  ariaSort?: "ascending" | "descending" | "none";
}

function SortIcon({ sort }: { sort: Column<unknown>["ariaSort"] }) {
  if (sort === "ascending") return <ArrowUp aria-hidden className="size-3.5 text-foreground" />;
  if (sort === "descending") return <ArrowDown aria-hidden className="size-3.5 text-foreground" />;
  return <ChevronsUpDown aria-hidden className="size-3.5 opacity-50" />;
}

export function Table<T>({
  caption,
  columns,
  rows,
  rowKey,
  leading,
}: {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Optional leading cell per row (ListView uses it for the select checkbox). */
  leading?: { header: ReactNode; cell: (row: T) => ReactNode };
}) {
  const th = "h-10 whitespace-nowrap px-3 text-left align-middle text-xs font-medium text-muted-foreground";
  const td = "px-3 py-2.5 align-middle";
  return (
    <div className="relative w-full overflow-x-auto rounded-lg border bg-card shadow-xs">
      <table className="w-full caption-bottom text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-muted/50">
          <tr className="border-b">
            {leading ? <th scope="col" className={`${th} w-10`}>{leading.header}</th> : null}
            {columns.map((c) => (
              <th key={c.key} scope="col" aria-sort={c.ariaSort} className={th}>
                {c.headerHref ? (
                  <a href={c.headerHref} className="-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent hover:text-foreground">
                    {c.label}
                    <SortIcon sort={c.ariaSort} />
                  </a>
                ) : (
                  c.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-b transition-colors last:border-0 hover:bg-muted/40">
              {leading ? <td className={td}>{leading.cell(row)}</td> : null}
              {columns.map((c) => (
                <td key={c.key} className={td}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
