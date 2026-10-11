"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";
import { format } from "date-fns";
import { ChevronDown, Loader2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Card, CardContent } from "@/components/ui/card";
import { DetailBreakdownChart } from "@/components/payroll/charts/detail-breakdown-chart";
import {
  buildDeductionItems,
  buildDeductionRow,
  buildSalaryEarningRow,
  buildSalaryOtherEarningItems,
  buildStatutoryDeductionItems,
  sumBreakdownItems,
  sumRecords,
  type ChartViewMode,
} from "@/lib/payroll/chart-data";
import { deleteSalaryAction } from "@/app/actions/payroll";
import type { ItemDTO, SalaryDTO } from "@/lib/payroll/types";

function groupSalariesByYear(salaries: SalaryDTO[]): { year: number; salaries: SalaryDTO[] }[] {
  const byYear = new Map<number, SalaryDTO[]>();
  for (const salary of salaries) {
    const year = new Date(salary.salaryDate).getFullYear();
    const group = byYear.get(year) ?? [];
    group.push(salary);
    byYear.set(year, group);
  }
  return [...byYear.entries()].sort(([a], [b]) => b - a).map(([year, salaries]) => ({ year, salaries }));
}

export function SalaryList({
  salaries,
  items,
  viewMode,
}: {
  salaries: SalaryDTO[];
  items: ItemDTO[];
  viewMode: ChartViewMode;
}) {
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function toggleExpanded(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const result = await deleteSalaryAction(id);
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <Button asChild variant="outline">
          <Link href="/salaries/new">PDFから登録</Link>
        </Button>
        <Button asChild>
          <Link href="/salaries/new">給与を登録</Link>
        </Button>
      </div>

      {viewMode === "monthly" ? (
        <SalaryYearGroup
          salaries={salaries}
          items={items}
          expandedId={expandedId}
          toggleExpanded={toggleExpanded}
          deletingId={deletingId}
          handleDelete={handleDelete}
        />
      ) : (
        <div className="space-y-2">
          {groupSalariesByYear(salaries).map(({ year, salaries: yearSalaries }, index, yearGroups) => {
            const grossTotal = yearSalaries.reduce((sum, s) => sum + Number(s.grossSalary), 0);
            const netTotal = yearSalaries.reduce((sum, s) => sum + Number(s.netSalary), 0);
            const yearKey = `year-${year}`;
            const previousYearSalaries = yearGroups[index + 1]?.salaries;
            const previousGrossTotal = previousYearSalaries?.reduce((sum, s) => sum + Number(s.grossSalary), 0);
            const previousNetTotal = previousYearSalaries?.reduce((sum, s) => sum + Number(s.netSalary), 0);
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
                    {grossTotal.toLocaleString()}
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
                      earningRow={sumRecords(yearSalaries.map((s) => buildSalaryEarningRow(s.data, items)))}
                      deductionRow={sumRecords(yearSalaries.map((s) => buildDeductionRow(s.data, items)))}
                      earningItemBreakdown={{
                        その他支給: sumBreakdownItems(yearSalaries.map((s) => buildSalaryOtherEarningItems(s.data, items))),
                      }}
                      deductionItemBreakdown={{
                        法定控除: sumBreakdownItems(yearSalaries.map((s) => buildStatutoryDeductionItems(s.data, items))),
                        控除: sumBreakdownItems(yearSalaries.map((s) => buildDeductionItems(s.data, items))),
                      }}
                      previousEarningTotal={previousGrossTotal}
                      previousDeductionTotal={
                        previousGrossTotal !== undefined && previousNetTotal !== undefined
                          ? previousGrossTotal - previousNetTotal
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

function SalaryYearGroup({
  salaries,
  items,
  expandedId,
  toggleExpanded,
  deletingId,
  handleDelete,
}: {
  salaries: SalaryDTO[];
  items: ItemDTO[];
  expandedId: string | null;
  toggleExpanded: (id: string) => void;
  deletingId: string | null;
  handleDelete: (id: string) => void;
}) {
  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>支給日</TableHead>
              <TableHead className="text-right">支給額</TableHead>
              <TableHead className="text-right">手取額</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {salaries.map((salary, index) => {
              const previousSalary = salaries[index + 1];
              return (
                <Fragment key={salary.id}>
                  <TableRow
                    className="cursor-pointer"
                    onClick={() => toggleExpanded(salary.id)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <ChevronDown
                          className={`size-4 shrink-0 text-muted-foreground transition-transform ${expandedId === salary.id ? "rotate-180" : ""}`}
                        />
                        {format(new Date(salary.salaryDate), "yyyy年MM月dd日")}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {Number(salary.grossSalary).toLocaleString()} 円
                    </TableCell>
                    <TableCell className="text-right">
                      {Number(salary.netSalary).toLocaleString()} 円
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button asChild variant="ghost" size="icon">
                          <Link href={`/salaries/${salary.id}/edit`}>
                            <Pencil className="size-4" />
                          </Link>
                        </Button>
                        <DeleteButton
                          onConfirm={() => handleDelete(salary.id)}
                          isDeleting={deletingId === salary.id}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                  {expandedId === salary.id && (
                    <TableRow key={`${salary.id}-detail`}>
                      <TableCell colSpan={4}>
                        <DetailBreakdownChart
                          earningRow={buildSalaryEarningRow(salary.data, items)}
                          deductionRow={buildDeductionRow(salary.data, items)}
                          earningItemBreakdown={{ その他支給: buildSalaryOtherEarningItems(salary.data, items) }}
                          deductionItemBreakdown={{
                            法定控除: buildStatutoryDeductionItems(salary.data, items),
                            控除: buildDeductionItems(salary.data, items),
                          }}
                          previousEarningTotal={previousSalary ? Number(previousSalary.grossSalary) : undefined}
                          previousDeductionTotal={
                            previousSalary
                              ? Number(previousSalary.grossSalary) - Number(previousSalary.netSalary)
                              : undefined
                          }
                        />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-2 md:hidden">
        {salaries.map((salary, index) => {
          const previousSalary = salaries[index + 1];
          return (
            <Card key={salary.id} className="cursor-pointer" onClick={() => toggleExpanded(salary.id)}>
              <CardContent className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  <ChevronDown
                    className={`size-4 shrink-0 text-muted-foreground transition-transform ${expandedId === salary.id ? "rotate-180" : ""}`}
                  />
                  <div>
                    <p className="font-medium">{format(new Date(salary.salaryDate), "yyyy年MM月dd日")}</p>
                    <p className="text-sm text-muted-foreground">
                      <span className="text-xs">支給額 </span>
                      {Number(salary.grossSalary).toLocaleString()}
                      <span className="text-xs">円</span>
                      {" / "}
                      <span className="text-xs">手取額 </span>
                      {Number(salary.netSalary).toLocaleString()}
                      <span className="text-xs">円</span>
                    </p>
                  </div>
                </div>
                <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button asChild variant="ghost" size="icon">
                    <Link href={`/salaries/${salary.id}/edit`}>
                      <Pencil className="size-4" />
                    </Link>
                  </Button>
                  <DeleteButton
                    onConfirm={() => handleDelete(salary.id)}
                    isDeleting={deletingId === salary.id}
                  />
                </div>
              </CardContent>
              {expandedId === salary.id && (
                <CardContent className="pt-0" onClick={(e) => e.stopPropagation()}>
                  <DetailBreakdownChart
                    earningRow={buildSalaryEarningRow(salary.data, items)}
                    deductionRow={buildDeductionRow(salary.data, items)}
                    earningItemBreakdown={{ その他支給: buildSalaryOtherEarningItems(salary.data, items) }}
                    deductionItemBreakdown={{
                      法定控除: buildStatutoryDeductionItems(salary.data, items),
                      控除: buildDeductionItems(salary.data, items),
                    }}
                    previousEarningTotal={previousSalary ? Number(previousSalary.grossSalary) : undefined}
                    previousDeductionTotal={
                      previousSalary
                        ? Number(previousSalary.grossSalary) - Number(previousSalary.netSalary)
                        : undefined
                    }
                  />
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}

function DeleteButton({
  onConfirm,
  isDeleting,
}: {
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
          <AlertDialogTitle>給与記録を削除しますか？</AlertDialogTitle>
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
