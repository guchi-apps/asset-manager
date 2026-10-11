"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { ChevronDown, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
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
import { TaxYearLink } from "@/components/payroll/payroll-summary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DetailBreakdownChart } from "@/components/payroll/charts/detail-breakdown-chart";
import { BonusEarningChart } from "@/components/payroll/charts/bonus-earning-chart";
import { BonusDeductionChart } from "@/components/payroll/charts/bonus-deduction-chart";
import { ChartViewModeToggle } from "@/components/payroll/charts/view-mode-toggle";
import {
  buildBonusEarningRow,
  buildBonusFutureDesignReserveItems,
  buildBonusOtherEarningItems,
  buildDeductionItems,
  buildDeductionRow,
  buildStatutoryDeductionItems,
  sumBreakdownItems,
  sumRecords,
  type ChartViewMode,
} from "@/lib/payroll/chart-data";
import { deleteBonusAction } from "@/app/actions/payroll";
import type { BonusDTO, ItemDTO } from "@/lib/payroll/types";

function groupBonusesByYear(bonuses: BonusDTO[]): { year: number; bonuses: BonusDTO[] }[] {
  const byYear = new Map<number, BonusDTO[]>();
  for (const bonus of bonuses) {
    const year = new Date(bonus.bonusDate).getFullYear();
    const group = byYear.get(year) ?? [];
    group.push(bonus);
    byYear.set(year, group);
  }
  return [...byYear.entries()].sort(([a], [b]) => b - a).map(([year, bonuses]) => ({ year, bonuses }));
}

export function BonusesClient({
  bonuses: initialBonuses,
  items,
}: {
  bonuses: BonusDTO[];
  items: ItemDTO[];
}) {
  const router = useRouter();
  const [bonuses, setBonuses] = useState(initialBonuses);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ChartViewMode>("monthly");

  function toggleExpanded(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const result = await deleteBonusAction(id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setBonuses((prev) => prev.filter((b) => b.id !== id));
      toast.success("削除しました");
      router.refresh();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <ChartViewModeToggle value={viewMode} onChange={setViewMode} />

      <Card>
        <CardHeader>
          <CardTitle>支給額の推移</CardTitle>
        </CardHeader>
        <CardContent>
          <BonusEarningChart bonuses={bonuses} items={items} viewMode={viewMode} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>控除の内訳</CardTitle>
        </CardHeader>
        <CardContent>
          <BonusDeductionChart bonuses={bonuses} items={items} viewMode={viewMode} />
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button asChild>
          <Link href="/bonuses/new">
            <Plus className="size-4" />
            賞与を登録
          </Link>
        </Button>
      </div>

      {viewMode === "monthly" ? (
        <BonusYearGroup
          bonuses={bonuses}
          items={items}
          expandedId={expandedId}
          toggleExpanded={toggleExpanded}
          deletingId={deletingId}
          handleDelete={handleDelete}
        />
      ) : (
        <div className="space-y-2">
          {groupBonusesByYear(bonuses).map(({ year, bonuses: yearBonuses }, index, yearGroups) => {
            const amountTotal = yearBonuses.reduce((sum, b) => sum + Number(b.amount), 0);
            const netTotal = yearBonuses.reduce((sum, b) => sum + Number(b.data.netAmount ?? 0), 0);
            const yearKey = `year-${year}`;
            const previousYearBonuses = yearGroups[index + 1]?.bonuses;
            const previousAmountTotal = previousYearBonuses?.reduce((sum, b) => sum + Number(b.amount), 0);
            const previousNetTotal = previousYearBonuses?.reduce(
              (sum, b) => sum + Number(b.data.netAmount ?? 0),
              0
            );
            return (
              <Card key={year} className="cursor-pointer" onClick={() => toggleExpanded(yearKey)}>
                <CardContent className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <ChevronDown
                      className={`size-4 shrink-0 text-muted-foreground transition-transform ${expandedId === yearKey ? "rotate-180" : ""}`}
                    />
                    <p className="font-medium">{year}年</p>
                    <TaxYearLink year={year} />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    <span className="text-xs">支給額 </span>
                    {amountTotal.toLocaleString()}
                    <span className="text-xs">円</span>
                    {" / "}
                    <span className="text-xs">手取額 </span>
                    {netTotal.toLocaleString()}
                    <span className="text-xs">円</span>
                  </p>
                </CardContent>
                {expandedId === yearKey && (
                  <CardContent className="pt-0" onClick={(e) => e.stopPropagation()}>
                    <DetailBreakdownChart
                      earningRow={sumRecords(yearBonuses.map((b) => buildBonusEarningRow(b.data, items)))}
                      deductionRow={sumRecords(yearBonuses.map((b) => buildDeductionRow(b.data, items)))}
                      earningItemBreakdown={{
                        "将来設計準備金 DC差引後": sumBreakdownItems(yearBonuses.map((b) => buildBonusFutureDesignReserveItems(b.data))),
                        その他支給: sumBreakdownItems(yearBonuses.map((b) => buildBonusOtherEarningItems(b.data, items))),
                      }}
                      deductionItemBreakdown={{
                        法定控除: sumBreakdownItems(yearBonuses.map((b) => buildStatutoryDeductionItems(b.data, items))),
                        控除: sumBreakdownItems(yearBonuses.map((b) => buildDeductionItems(b.data, items))),
                      }}
                      previousEarningTotal={previousAmountTotal}
                      previousDeductionTotal={
                        previousAmountTotal !== undefined && previousNetTotal !== undefined
                          ? previousAmountTotal - previousNetTotal
                          : undefined
                      }
                      comparisonLabel="前年"
                    />
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BonusYearGroup({
  bonuses,
  items,
  expandedId,
  toggleExpanded,
  deletingId,
  handleDelete,
}: {
  bonuses: BonusDTO[];
  items: ItemDTO[];
  expandedId: string | null;
  toggleExpanded: (id: string) => void;
  deletingId: string | null;
  handleDelete: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      {bonuses.map((bonus, index) => {
        const previousBonus = bonuses[index + 1];
        return (
          <Card key={bonus.id} className="cursor-pointer" onClick={() => toggleExpanded(bonus.id)}>
            <CardContent className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <ChevronDown
                  className={`size-4 shrink-0 text-muted-foreground transition-transform ${expandedId === bonus.id ? "rotate-180" : ""}`}
                />
                <div>
                  <p className="font-medium">
                    {format(new Date(bonus.bonusDate), "yyyy年MM月dd日")}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    <span className="text-xs">支給額 </span>
                    {Number(bonus.amount).toLocaleString()}
                    <span className="text-xs">円</span>
                    {" / "}
                    <span className="text-xs">手取額 </span>
                    {Number(bonus.data.netAmount ?? 0).toLocaleString()}
                    <span className="text-xs">円</span>
                  </p>
                </div>
              </div>
              <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                <Button asChild variant="ghost" size="icon">
                  <Link href={`/bonuses/${bonus.id}/edit`}>
                    <Pencil className="size-4" />
                  </Link>
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" disabled={deletingId === bonus.id}>
                      {deletingId === bonus.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>賞与を削除しますか？</AlertDialogTitle>
                      <AlertDialogDescription>この操作は取り消せません。</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={deletingId === bonus.id}>
                        キャンセル
                      </AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => handleDelete(bonus.id)}
                        disabled={deletingId === bonus.id}
                      >
                        {deletingId === bonus.id ? (
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
              </div>
            </CardContent>
            {expandedId === bonus.id && (
              <CardContent className="pt-0" onClick={(e) => e.stopPropagation()}>
                <DetailBreakdownChart
                  earningRow={buildBonusEarningRow(bonus.data, items)}
                  deductionRow={buildDeductionRow(bonus.data, items)}
                  earningItemBreakdown={{
                    "将来設計準備金 DC差引後": buildBonusFutureDesignReserveItems(bonus.data),
                    その他支給: buildBonusOtherEarningItems(bonus.data, items),
                  }}
                  deductionItemBreakdown={{
                    法定控除: buildStatutoryDeductionItems(bonus.data, items),
                    控除: buildDeductionItems(bonus.data, items),
                  }}
                  previousEarningTotal={previousBonus ? Number(previousBonus.amount) : undefined}
                  previousDeductionTotal={
                    previousBonus
                      ? Number(previousBonus.amount) - Number(previousBonus.data.netAmount ?? 0)
                      : undefined
                  }
                />
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
