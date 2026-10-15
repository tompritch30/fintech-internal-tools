import type { ReactNode } from "react";

export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  /** When set, the header becomes a link (used by ListView for sorting). */
  headerHref?: string;
  ariaSort?: "ascending" | "descending" | "none";
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
  return (
    <table className="fit-table">
      <caption className="fit-visually-hidden">{caption}</caption>
      <thead>
        <tr>
          {leading ? <th scope="col">{leading.header}</th> : null}
          {columns.map((c) => (
            <th key={c.key} scope="col" aria-sort={c.ariaSort}>
              {c.headerHref ? <a href={c.headerHref}>{c.label}</a> : c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={rowKey(row)}>
            {leading ? <td>{leading.cell(row)}</td> : null}
            {columns.map((c) => (
              <td key={c.key}>{c.render(row)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
