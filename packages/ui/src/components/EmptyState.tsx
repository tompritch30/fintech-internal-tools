import type { ReactNode } from "react";

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="fit-empty" role="status">
      <strong>{title}</strong>
      {children ? <div>{children}</div> : null}
    </div>
  );
}
