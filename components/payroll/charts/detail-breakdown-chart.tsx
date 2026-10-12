"use client";

import { useState, type ReactNode } from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import type { BreakdownItem } from "@/lib/payroll/chart-data";
import { DEDUCTION_COLORS, DETAIL_COLORS, EARNING_COLORS, labelInkFor, resolveColor } from "./chart-colors";
import { useIsDarkTheme } from "./use-is-dark-theme";

type Side = "earning" | "deduction";
type Selection = { side: Side; category: string; item?: string };
type Slice = { name: string; value: number; fill: string; ink: string };

// 内訳の色は8色しか用意していないため、9項目目以降は「その他」へまとめる。
const MAX_DETAIL_SLICES = 8;
// 棒の中に割合を書くのはいちばん大きい区画だけにする。
// 全区画に振ると読まれなくなるうえ、狭い区画では文字が収まらない。
const INLINE_LABEL_MIN_SHARE = 0.12;
const REST_LABEL_MIN_SHARE = 0.3;
const BAR_MIN_SEGMENT_PX = 4;

function formatDiff(diff: number): string {
  if (diff === 0) return "±0円";
  return `${diff > 0 ? "+" : ""}${diff.toLocaleString()}円`;
}

function formatShare(value: number, total: number): string {
  if (total <= 0) return "-";
  return `${((value / total) * 100).toFixed(1)}%`;
}

function DiffLabel({ diff, label }: { diff: number; label: string }) {
  return (
    <span className="ml-1 text-xs font-normal text-muted-foreground">
      ({label}比 {formatDiff(diff)})
    </span>
  );
}

function toSlice(name: string, value: number, pair: { light: string; dark: string }, isDark: boolean): Slice {
  const fill = resolveColor(pair, isDark);
  return { name, value, fill, ink: labelInkFor(fill) };
}

// 元のカテゴリ順で色を割り当ててからゼロ値を除外する。
// こうすることで、同じカテゴリは他の画面のグラフと常に同じ色になる。
function toCategorySlices(
  row: Record<string, number>,
  palette: readonly { light: string; dark: string }[],
  isDark: boolean
): Slice[] {
  return Object.entries(row)
    .map(([name, value], i) => toSlice(name, value, palette[i % palette.length], isDark))
    .filter((slice) => slice.value > 0);
}

// 内訳は金額の大きい順に並べ、色が足りない分は「その他」へ畳む。
function toDetailSlices(items: BreakdownItem[], isDark: boolean): Slice[] {
  const sorted = [...items].filter((item) => item.value > 0).sort((a, b) => b.value - a.value);
  const overflowing = sorted.length > MAX_DETAIL_SLICES;
  const shown = overflowing ? sorted.slice(0, MAX_DETAIL_SLICES - 1) : sorted;
  const folded = overflowing ? sorted.slice(MAX_DETAIL_SLICES - 1) : [];
  const merged = folded.length > 0
    ? [...shown, { name: "その他", value: folded.reduce((sum, item) => sum + item.value, 0) }]
    : shown;
  return merged.map((item, i) => toSlice(item.name, item.value, DETAIL_COLORS[i], isDark));
}

function totalOf(slices: Slice[]): number {
  return slices.reduce((sum, slice) => sum + slice.value, 0);
}

type BarSegment = Slice & { onClick?: () => void; description: string };

function Bar({
  segments,
  total,
  selectedName,
  restLabel,
  restValue,
}: {
  segments: BarSegment[];
  total: number;
  selectedName: string | null;
  restLabel?: string;
  restValue?: number;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const hasRest = restValue !== undefined && restValue > 0;

  // ツールチップの位置は区画の中心。実測せずに割合から出せるので、
  // 幅が変わってもそのまま追従する。
  let consumed = 0;
  const centers = new Map<string, number>();
  for (const segment of segments) {
    centers.set(segment.name, ((consumed + segment.value / 2) / total) * 100);
    consumed += segment.value;
  }
  if (hasRest && restLabel) {
    centers.set(restLabel, ((consumed + restValue / 2) / total) * 100);
  }

  const hoveredSegment = segments.find((segment) => segment.name === hovered);
  const hoveredDescription =
    hoveredSegment?.description ??
    (hasRest && restLabel && hovered === restLabel
      ? `${restLabel} ${restValue.toLocaleString()}円 ・ ${formatShare(restValue, total)}`
      : null);
  const hoveredCenter = hovered ? centers.get(hovered) : undefined;

  return (
    <div className="relative">
      {hoveredDescription && hoveredCenter !== undefined && (
        <div
          className="pointer-events-none absolute bottom-full z-20 mb-1.5 -translate-x-1/2 rounded-md border bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow-md"
          style={{ left: `${Math.min(94, Math.max(6, hoveredCenter))}%` }}
        >
          {hoveredDescription}
        </div>
      )}
      <div className="flex h-[22px] w-full gap-0.5">
        {segments.map((segment, index) => {
          const share = total > 0 ? segment.value / total : 0;
          const showLabel =
            share >= INLINE_LABEL_MIN_SHARE && segment.value === Math.max(...segments.map((s) => s.value));
          const selected = selectedName === segment.name;
          const Tag = segment.onClick ? "button" : "div";
          return (
            <Tag
              key={segment.name}
              {...(segment.onClick ? { type: "button" as const, onClick: segment.onClick } : {})}
              onPointerEnter={() => setHovered(segment.name)}
              onPointerLeave={() => setHovered((prev) => (prev === segment.name ? null : prev))}
              onFocus={() => setHovered(segment.name)}
              onBlur={() => setHovered((prev) => (prev === segment.name ? null : prev))}
              aria-label={segment.description}
              className={cn(
                "flex h-full items-center justify-center overflow-hidden text-[11px] font-semibold transition-opacity",
                index === segments.length - 1 && !hasRest && "rounded-r-[4px]",
                segment.onClick && "cursor-pointer",
                selectedName !== null && !selected && "opacity-30",
                selected && "z-10 ring-2 ring-foreground ring-offset-2 ring-offset-card"
              )}
              style={{
                flexGrow: segment.value,
                flexBasis: 0,
                minWidth: BAR_MIN_SEGMENT_PX,
                backgroundColor: segment.fill,
                color: segment.ink,
              }}
            >
              {showLabel ? `${Math.round(share * 100)}%` : null}
            </Tag>
          );
        })}
        {hasRest && (
          <div
            onPointerEnter={() => restLabel && setHovered(restLabel)}
            onPointerLeave={() => setHovered(null)}
            className={cn(
              "flex h-full items-center justify-center rounded-r-[4px] bg-muted text-[11px] font-semibold text-muted-foreground",
              selectedName !== null && "opacity-30"
            )}
            style={{ flexGrow: restValue, flexBasis: 0, minWidth: BAR_MIN_SEGMENT_PX }}
          >
            {total > 0 && restValue / total >= REST_LABEL_MIN_SHARE
              ? `${restLabel} ${Math.round((restValue / total) * 100)}%`
              : null}
          </div>
        )}
      </div>
    </div>
  );
}

function Legend({
  slices,
  total,
  selectedName,
  onSelect,
  rest,
}: {
  slices: Slice[];
  total: number;
  selectedName: string | null;
  onSelect?: (name: string) => void;
  rest?: { name: string; value: number };
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-muted-foreground">
      {slices.map((slice) => {
        const selected = selectedName === slice.name;
        const Tag = onSelect ? "button" : "span";
        return (
          <Tag
            key={slice.name}
            {...(onSelect ? { type: "button" as const, onClick: () => onSelect(slice.name) } : {})}
            className={cn("flex items-center gap-1.5", selected && "font-semibold text-foreground")}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: slice.fill }} />
            {slice.name}
            <span className="tabular-nums">{formatShare(slice.value, total)}</span>
          </Tag>
        );
      })}
      {rest && rest.value > 0 && (
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-muted ring-1 ring-border ring-inset" />
          {rest.name}
          <span className="tabular-nums">{formatShare(rest.value, total)}</span>
        </span>
      )}
    </div>
  );
}

function CategoryTable({
  title,
  total,
  previousTotal,
  comparisonLabel,
  side,
  slices,
  itemBreakdown,
  grossTotal,
  isDark,
  selection,
  isDrillable,
  onSelectCategory,
  onSelectItem,
  footer,
}: {
  title: string;
  total: number;
  previousTotal?: number;
  comparisonLabel: string;
  side: Side;
  slices: Slice[];
  itemBreakdown?: Record<string, BreakdownItem[]>;
  grossTotal: number;
  isDark: boolean;
  selection: Selection | null;
  isDrillable: (side: Side, category: string) => boolean;
  onSelectCategory: (side: Side, category: string) => void;
  onSelectItem: (side: Side, category: string, item: string) => void;
  footer?: ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2 border-b pb-1.5 text-sm font-semibold">
        <span>{title}</span>
        <span className="tabular-nums">
          {total.toLocaleString()} 円
          {previousTotal !== undefined && <DiffLabel diff={total - previousTotal} label={comparisonLabel} />}
        </span>
      </div>
      <ul className="space-y-0.5 text-sm">
        {slices.map((slice) => {
          const items = itemBreakdown?.[slice.name] ?? [];
          const detailTotal = totalOf(toDetailSlices(items, isDark));
          const categorySelected =
            selection?.side === side && selection.category === slice.name && selection.item === undefined;
          return (
            <li key={slice.name}>
              <button
                type="button"
                onClick={() => onSelectCategory(side, slice.name)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-0.5 text-left transition-colors hover:bg-muted",
                  categorySelected && "bg-accent font-semibold text-accent-foreground hover:bg-accent"
                )}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: slice.fill }} />
                  <span className="truncate">{slice.name}</span>
                  {isDrillable(side, slice.name) && <ChevronRight className="size-3.5 shrink-0 opacity-60" />}
                </span>
                <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
                  <span>{slice.value.toLocaleString()} 円</span>
                  <span className="text-xs opacity-70">{formatShare(slice.value, grossTotal)}</span>
                </span>
              </button>
              {items.length > 0 && (
                <ul className="ml-4 space-y-0.5 text-xs">
                  {items.map((item) => {
                    const itemSelected =
                      selection?.side === side && selection.category === slice.name && selection.item === item.name;
                    return (
                      <li key={item.name}>
                        <button
                          type="button"
                          onClick={() => onSelectItem(side, slice.name, item.name)}
                          className={cn(
                            "flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-0.5 text-left text-muted-foreground transition-colors hover:bg-muted",
                            itemSelected && "bg-accent font-semibold text-accent-foreground hover:bg-accent"
                          )}
                        >
                          <span className="truncate">{item.name}</span>
                          <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
                            <span>{item.value.toLocaleString()} 円</span>
                            <span className="opacity-70">
                              {item.value > 0 ? formatShare(item.value, detailTotal) : "-"}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
        {footer}
      </ul>
    </div>
  );
}

export function DetailBreakdownChart({
  earningRow,
  deductionRow,
  earningItemBreakdown,
  deductionItemBreakdown,
  previousEarningTotal,
  previousDeductionTotal,
  comparisonLabel = "前月",
}: {
  earningRow: Record<string, number>;
  deductionRow: Record<string, number>;
  earningItemBreakdown?: Record<string, BreakdownItem[]>;
  deductionItemBreakdown?: Record<string, BreakdownItem[]>;
  previousEarningTotal?: number;
  previousDeductionTotal?: number;
  comparisonLabel?: string;
}) {
  const isDark = useIsDarkTheme();
  const [drilldown, setDrilldown] = useState<{ side: Side; category: string } | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);

  const earningSlices = toCategorySlices(earningRow, EARNING_COLORS, isDark);
  const deductionSlices = toCategorySlices(deductionRow, DEDUCTION_COLORS, isDark);
  const grossTotal = totalOf(earningSlices);
  const deductionTotal = totalOf(deductionSlices);
  const netAmount = grossTotal - deductionTotal;
  const previousNetAmount =
    previousEarningTotal !== undefined && previousDeductionTotal !== undefined
      ? previousEarningTotal - previousDeductionTotal
      : undefined;

  const breakdownOf = (side: Side, category: string): BreakdownItem[] =>
    (side === "earning" ? earningItemBreakdown : deductionItemBreakdown)?.[category] ?? [];

  // 内訳が1件しかない分類は、開いても100%の棒が出るだけなので開かせない。
  const isDrillable = (side: Side, category: string) =>
    toDetailSlices(breakdownOf(side, category), isDark).length > 1;

  function handleSelectCategory(side: Side, category: string) {
    if (!isDrillable(side, category)) {
      setSelection((prev) =>
        prev?.side === side && prev.category === category && prev.item === undefined
          ? null
          : { side, category }
      );
      return;
    }
    const alreadyOpen = drilldown?.side === side && drilldown.category === category;
    setDrilldown(alreadyOpen ? null : { side, category });
    setSelection({ side, category });
  }

  function handleSelectItem(side: Side, category: string, item: string) {
    if (isDrillable(side, category)) setDrilldown({ side, category });
    setSelection((prev) =>
      prev?.side === side && prev.category === category && prev.item === item ? null : { side, category, item }
    );
  }

  if (earningSlices.length === 0 && deductionSlices.length === 0) {
    return (
      <div className="flex h-[180px] w-full items-center justify-center text-sm text-muted-foreground">
        データがありません
      </div>
    );
  }

  const drilldownItems = drilldown ? breakdownOf(drilldown.side, drilldown.category) : [];
  const drilldownSlices = toDetailSlices(drilldownItems, isDark);
  const drilldownTotal = totalOf(drilldownSlices);
  // 精算項目や年末調整の差額はマイナスになり得る。積み上げ横棒にも「分類に占める割合」にも
  // 載せられないため棒からは外し、金額は一覧表に残したうえで外した旨をここで断る。
  const excludedFromBar = drilldownItems.filter((item) => item.value <= 0);
  // 内訳の強調は、いま開いている分類の選択だけを見る（別の分類の選択が残っていても引きずらない）
  const selectedItemName =
    selection?.item !== undefined &&
    selection.side === drilldown?.side &&
    selection.category === drilldown?.category
      ? selection.item
      : null;
  const selectedCategoryName = (side: Side) =>
    selection?.side === side && selection.item === undefined ? selection.category : null;

  return (
    <div className="space-y-4">
      {drilldown ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setDrilldown(null)}
              className="flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold transition-colors hover:bg-muted"
            >
              <ArrowLeft className="size-3.5" />
              大分類へ戻る
            </button>
            <span className="text-xs text-muted-foreground">
              {drilldown.side === "earning" ? "支給" : "控除"} ／{" "}
              <span className="font-semibold text-foreground">{drilldown.category}</span>
            </span>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-sm font-semibold">{drilldown.category}の内訳</span>
            <span className="text-xs text-muted-foreground tabular-nums">
              横軸の最大値 = {drilldownTotal.toLocaleString()}円（100%）・支給総額の{" "}
              {formatShare(drilldownTotal, grossTotal)}
            </span>
          </div>
          <Bar
            segments={drilldownSlices.map((slice) => ({
              ...slice,
              onClick: () => handleSelectItem(drilldown.side, drilldown.category, slice.name),
              description: `${slice.name} ${slice.value.toLocaleString()}円 ・ ${drilldown.category}の ${formatShare(slice.value, drilldownTotal)}`,
            }))}
            total={drilldownTotal}
            selectedName={selectedItemName}
          />
          <Legend
            slices={drilldownSlices}
            total={drilldownTotal}
            selectedName={selectedItemName}
            onSelect={(name) => handleSelectItem(drilldown.side, drilldown.category, name)}
          />
          {excludedFromBar.length > 0 && (
            <p className="text-xs text-muted-foreground">
              マイナスの項目（
              {excludedFromBar.map((item) => `${item.name} ${item.value.toLocaleString()}円`).join("、")}
              ）は棒に含めていません。金額は下の一覧表を参照してください。
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-sm font-semibold">支給と控除の構成</span>
            <span className="text-xs text-muted-foreground tabular-nums">
              横軸の最大値 = 支給総額 {grossTotal.toLocaleString()}円（100%）
            </span>
          </div>

          {(
            [
              { side: "earning" as const, label: "支給", slices: earningSlices, total: grossTotal },
              { side: "deduction" as const, label: "控除", slices: deductionSlices, total: deductionTotal },
            ] satisfies { side: Side; label: string; slices: Slice[]; total: number }[]
          ).map((group) => (
            <div key={group.side} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-semibold">{group.label}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  <span className="font-semibold text-foreground">{group.total.toLocaleString()}</span> 円
                  {group.side === "deduction" && ` ・ 支給総額の ${formatShare(group.total, grossTotal)}`}
                </span>
              </div>
              <Bar
                segments={group.slices.map((slice) => ({
                  ...slice,
                  onClick: () => handleSelectCategory(group.side, slice.name),
                  description: `${slice.name} ${slice.value.toLocaleString()}円 ・ 支給総額の ${formatShare(slice.value, grossTotal)}${
                    isDrillable(group.side, slice.name) ? "（クリックで内訳へ）" : ""
                  }`,
                }))}
                total={grossTotal}
                selectedName={selectedCategoryName(group.side)}
                restLabel={group.side === "deduction" ? "手取り額" : undefined}
                restValue={group.side === "deduction" ? netAmount : undefined}
              />
              <Legend
                slices={group.slices}
                total={grossTotal}
                selectedName={selectedCategoryName(group.side)}
                onSelect={(name) => handleSelectCategory(group.side, name)}
                rest={group.side === "deduction" ? { name: "手取り額", value: netAmount } : undefined}
              />
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        <CategoryTable
          title="支給合計"
          total={grossTotal}
          previousTotal={previousEarningTotal}
          comparisonLabel={comparisonLabel}
          side="earning"
          slices={earningSlices}
          itemBreakdown={earningItemBreakdown}
          grossTotal={grossTotal}
          isDark={isDark}
          selection={selection}
          isDrillable={isDrillable}
          onSelectCategory={handleSelectCategory}
          onSelectItem={handleSelectItem}
        />
        <CategoryTable
          title="控除合計"
          total={deductionTotal}
          previousTotal={previousDeductionTotal}
          comparisonLabel={comparisonLabel}
          side="deduction"
          slices={deductionSlices}
          itemBreakdown={deductionItemBreakdown}
          grossTotal={grossTotal}
          isDark={isDark}
          selection={selection}
          isDrillable={isDrillable}
          onSelectCategory={handleSelectCategory}
          onSelectItem={handleSelectItem}
          footer={
            netAmount > 0 ? (
              <li className="mt-1.5 border-t pt-1.5">
                <div className="flex items-center justify-between gap-2 px-1.5 text-sm font-semibold">
                  <span>手取り額</span>
                  <span className="tabular-nums">
                    {netAmount.toLocaleString()} 円
                    {previousNetAmount !== undefined && (
                      <DiffLabel diff={netAmount - previousNetAmount} label={comparisonLabel} />
                    )}
                  </span>
                </div>
              </li>
            ) : undefined
          }
        />
      </div>
    </div>
  );
}
