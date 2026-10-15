/** Link tabs, e.g. a queue's status filter. State lives in the URL. */
export function Tabs({ label, items }: { label: string; items: { href: string; label: string; current: boolean }[] }) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-1 rounded-lg border bg-muted/50 p-1 text-sm w-fit">
      {items.map((item) => (
        <a
          key={item.href}
          href={item.href}
          aria-current={item.current ? "page" : undefined}
          className="rounded-md px-2.5 py-1 text-muted-foreground hover:text-foreground aria-[current=page]:bg-background aria-[current=page]:font-medium aria-[current=page]:text-foreground aria-[current=page]:shadow-xs"
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}
