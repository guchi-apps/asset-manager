export function ChartLegend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((item) => (
        <span key={item.name} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
          {item.name}
        </span>
      ))}
    </div>
  );
}
