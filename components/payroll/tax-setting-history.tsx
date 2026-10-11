"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
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
import { deleteTaxSettingAction } from "@/app/actions/payroll";
import type { TaxSettingDTO } from "@/lib/payroll/types";

export function TaxSettingHistory({
  taxSettings,
  selectedYear,
  selectedMonth,
}: {
  taxSettings: TaxSettingDTO[];
  selectedYear: number;
  selectedMonth: number;
}) {
  const router = useRouter();

  if (taxSettings.length === 0) return null;

  async function handleDelete(id: string) {
    const result = await deleteTaxSettingAction(id);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success("削除しました");
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">改定履歴</p>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="p-2 text-left font-medium">適用開始年月</th>
              <th className="p-2 text-right font-medium">健康保険料率</th>
              <th className="p-2 text-right font-medium">厚生年金料率</th>
              <th className="p-2 text-right font-medium">雇用保険料率</th>
              <th className="w-20" />
            </tr>
          </thead>
          <tbody>
            {taxSettings.map((setting) => {
              const date = new Date(setting.effectiveFrom);
              const year = date.getUTCFullYear();
              const month = date.getUTCMonth() + 1;
              const isSelected = year === selectedYear && month === selectedMonth;
              return (
                <tr key={setting.id} className={cn("border-t", isSelected && "bg-primary/5")}>
                  <td className="p-2">
                    <Link
                      href={`/salaries/settings?year=${year}&month=${month}`}
                      className={cn("hover:underline", isSelected && "font-medium text-primary")}
                    >
                      {year}年{month}月〜
                    </Link>
                  </td>
                  <td className="p-2 text-right">{Number(setting.healthInsuranceRate)}%</td>
                  <td className="p-2 text-right">{Number(setting.pensionRate)}%</td>
                  <td className="p-2 text-right">{Number(setting.employmentInsuranceRate)}%</td>
                  <td className="p-2">
                    <div className="flex justify-end gap-1">
                      <Button asChild variant="ghost" size="icon">
                        <Link href={`/salaries/settings?year=${year}&month=${month}`}>
                          <Pencil className="size-4" />
                        </Link>
                      </Button>
                      <DeleteButton year={year} month={month} onConfirm={() => handleDelete(setting.id)} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DeleteButton({
  year,
  month,
  onConfirm,
}: {
  year: number;
  month: number;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon">
          <Trash2 className="size-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {year}年{month}月〜の設定を削除しますか？
          </AlertDialogTitle>
          <AlertDialogDescription>この操作は取り消せません。</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>キャンセル</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>削除する</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
