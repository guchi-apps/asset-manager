"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ChevronDown, Loader2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { DetailBreakdownChart } from "@/components/payroll/charts/detail-breakdown-chart";
import {
  buildBonusEarningRow,
  buildBonusFutureDesignReserveItems,
  buildBonusOtherEarningItems,
  buildDeductionItems,
  buildDeductionRow,
  buildSalaryEarningRow,
  buildSalaryOtherEarningItems,
  buildStatutoryDeductionItems,
} from "@/lib/payroll/chart-data";
import { mergePayrollEntries, type PayrollEntry } from "@/lib/payroll/combined";
import { deleteBonusAction, deleteSalaryAction } from "@/app/actions/payroll";
import type { BonusDTO, ItemDTO, SalaryDTO } from "@/lib/payroll/types";

// 給与と賞与を支給日の新しい順に1本へ並べた明細一覧（Issue #1182）。賞与にはバッジと色帯を付ける
export function PayrollTimeline({
  salaries,
  bonuses,
  items,
}: {
  salaries: SalaryDTO[];
  bonuses: BonusDTO[];
  items: ItemDTO[];
}) {
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const entries = useMemo(() => mergePayrollEntries(salaries, bonuses), [salaries, bonuses]);

  async function handleDelete(entry: PayrollEntry) {
    setDeletingId(entry.id);
    try {
      const result = entry.kind === "bonus" ? await deleteBonusAction(entry.id) : await deleteSalaryAction(entry.id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("削除しました");
      router.refresh();
    } finally {
      setDeletingId(null);
    }
  }

  if (entries.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">給与・賞与の登録はまだありません</p>;
  }

  return (
    <div className="space-y-2">
      {entries.map((entry, index) => {
        const isBonus = entry.kind === "bonus";
        // 前回との比較は同じ種別（給与は前回の給与、賞与は前回の賞与）と行う
        const previous = entries.slice(index + 1).find((e) => e.kind === entry.kind);
        const expanded = expandedId === entry.id;
        return (
          <Card
            key={`${entry.kind}-${entry.id}`}
            className={`cursor-pointer ${isBonus ? "border-l-4 border-l-amber-500" : ""}`}
            onClick={() => setExpandedId((prev) => (prev === entry.id ? null : entry.id))}
          >
            <CardContent className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1">
                <ChevronDown
                  className={`size-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
                />
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium">
                    {format(new Date(entry.date), "yyyy年MM月dd日")}
                    {isBonus && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                        賞与
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    <span className="text-xs">支給額 </span>
                    {entry.gross.toLocaleString()}
                    <span className="text-xs">円</span>
                    {" / "}
                    <span className="text-xs">手取額 </span>
                    {entry.net.toLocaleString()}
                    <span className="text-xs">円</span>
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 gap-1" onClick={(e) => e.stopPropagation()}>
                <Button asChild variant="ghost" size="icon">
                  <Link href={isBonus ? `/bonuses/${entry.id}/edit` : `/salaries/${entry.id}/edit`}>
                    <Pencil className="size-4" />
                  </Link>
                </Button>
                <DeleteButton
                  label={isBonus ? "賞与" : "給与記録"}
                  onConfirm={() => handleDelete(entry)}
                  isDeleting={deletingId === entry.id}
                />
              </div>
            </CardContent>
            {expanded && (
              <CardContent className="pt-0" onClick={(e) => e.stopPropagation()}>
                <EntryDetail entry={entry} previous={previous} items={items} />
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function EntryDetail({
  entry,
  previous,
  items,
}: {
  entry: PayrollEntry;
  previous: PayrollEntry | undefined;
  items: ItemDTO[];
}) {
  const previousProps = {
    previousEarningTotal: previous ? previous.gross : undefined,
    previousDeductionTotal: previous ? previous.gross - previous.net : undefined,
  };
  if (entry.kind === "bonus") {
    const data = entry.bonus.data;
    return (
      <DetailBreakdownChart
        earningRow={buildBonusEarningRow(data, items)}
        deductionRow={buildDeductionRow(data, items)}
        earningItemBreakdown={{
          "将来設計準備金 DC差引後": buildBonusFutureDesignReserveItems(data),
          その他支給: buildBonusOtherEarningItems(data, items),
        }}
        deductionItemBreakdown={{
          法定控除: buildStatutoryDeductionItems(data, items),
          控除: buildDeductionItems(data, items),
        }}
        {...previousProps}
      />
    );
  }
  const data = entry.salary.data;
  return (
    <DetailBreakdownChart
      earningRow={buildSalaryEarningRow(data, items)}
      deductionRow={buildDeductionRow(data, items)}
      earningItemBreakdown={{ その他支給: buildSalaryOtherEarningItems(data, items) }}
      deductionItemBreakdown={{
        法定控除: buildStatutoryDeductionItems(data, items),
        控除: buildDeductionItems(data, items),
      }}
      {...previousProps}
    />
  );
}

function DeleteButton({
  label,
  onConfirm,
  isDeleting,
}: {
  label: string;
  onConfirm: () => void;
  isDeleting: boolean;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" disabled={isDeleting}>
          {isDeleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{label}を削除しますか？</AlertDialogTitle>
          <AlertDialogDescription>この操作は取り消せません。</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>キャンセル</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={isDeleting}>
            {isDeleting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                削除中...
              </>
            ) : (
              "削除する"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
