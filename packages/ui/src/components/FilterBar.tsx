import { cn } from "../lib/cn.ts";
import { buttonClass } from "./Button.tsx";
import { inputClass } from "./Input.tsx";

export interface FilterField {
  name: string;
  label: string;
  type: "date" | "text" | "select";
  /** For selects; an empty "Any" option is always first. */
  options?: { value: string; label: string }[];
  placeholder?: string;
}

/** GET form of labelled filters. Values live in the URL, so it works without JavaScript. */
export function FilterBar({
  label,
  basePath,
  fields,
  values,
}: {
  label: string;
  basePath: string;
  fields: FilterField[];
  values: Record<string, string | undefined>;
}) {
  const active = fields.some((f) => values[f.name]);
  return (
    <form method="get" action={basePath} aria-label={label} className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3 shadow-xs">
      {fields.map((f) => {
        const id = `filter-${f.name}`;
        return (
          <div key={f.name} className="grid gap-1.5">
            <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
              {f.label}
            </label>
            {f.type === "select" ? (
              <select id={id} name={f.name} defaultValue={values[f.name] ?? ""} className={cn(inputClass, "w-44")}>
                <option value="">Any</option>
                {(f.options ?? []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={id}
                name={f.name}
                type={f.type}
                defaultValue={values[f.name] ?? ""}
                placeholder={f.placeholder}
                className={cn(inputClass, f.type === "date" ? "w-40" : "w-44")}
              />
            )}
          </div>
        );
      })}
      <button type="submit" className={buttonClass("primary")}>
        Apply filters
      </button>
      {active ? (
        <a href={basePath} className={buttonClass("ghost")}>
          Clear
        </a>
      ) : null}
    </form>
  );
}
