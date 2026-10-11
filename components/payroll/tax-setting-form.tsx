"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { CreateTaxSettingSchema } from "@/lib/payroll/validators";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveTaxSettingAction } from "@/app/actions/payroll";
import type { TaxSettingDTO } from "@/lib/payroll/types";

const formSchema = CreateTaxSettingSchema.pick({
  effectiveYear: true,
  effectiveMonth: true,
  healthInsuranceRate: true,
  pensionRate: true,
  employmentInsuranceRate: true,
}).required();

type FormValues = {
  effectiveYear: number;
  effectiveMonth: number;
  healthInsuranceRate: number;
  pensionRate: number;
  employmentInsuranceRate: number;
};

export function TaxSettingForm({
  year,
  month,
  taxSetting,
  applicableTaxSetting,
}: {
  year: number;
  month: number;
  taxSetting: TaxSettingDTO | null;
  applicableTaxSetting: TaxSettingDTO | null;
}) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const defaults = taxSetting ?? applicableTaxSetting;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    values: {
      effectiveYear: year,
      effectiveMonth: month,
      healthInsuranceRate: defaults ? Number(defaults.healthInsuranceRate) : 9.15,
      pensionRate: defaults ? Number(defaults.pensionRate) : 9.15,
      employmentInsuranceRate: defaults ? Number(defaults.employmentInsuranceRate) : 0.6,
    },
  });

  function handleDateChange(nextYear: number, nextMonth: number) {
    router.push(`/salaries/settings?year=${nextYear}&month=${nextMonth}`);
  }

  async function onSubmit(values: FormValues) {
    setIsSubmitting(true);
    try {
      const result = await saveTaxSettingAction(values);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("保険料率を更新しました");
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="max-w-lg space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:w-64">
        <div className="space-y-1.5">
          <Label htmlFor="effectiveYear">適用年</Label>
          <Input
            id="effectiveYear"
            type="number"
            value={year}
            onChange={(e) => handleDateChange(Number(e.target.value), month)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="effectiveMonth">適用月</Label>
          <Input
            id="effectiveMonth"
            type="number"
            min={1}
            max={12}
            value={month}
            onChange={(e) => handleDateChange(year, Number(e.target.value))}
          />
        </div>
      </div>

      {!taxSetting && applicableTaxSetting && (
        <p className="text-xs text-muted-foreground">
          {year}年{month}月時点の設定はまだありません。直近で適用されている料率を初期値として表示しています。
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="healthInsuranceRate">健康保険料率（%）</Label>
          <Input
            id="healthInsuranceRate"
            type="number"
            step="0.0001"
            {...register("healthInsuranceRate", { valueAsNumber: true })}
          />
          {errors.healthInsuranceRate && (
            <p className="text-sm text-destructive">{errors.healthInsuranceRate.message}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pensionRate">厚生年金料率（%）</Label>
          <Input
            id="pensionRate"
            type="number"
            step="0.0001"
            {...register("pensionRate", { valueAsNumber: true })}
          />
          {errors.pensionRate && (
            <p className="text-sm text-destructive">{errors.pensionRate.message}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="employmentInsuranceRate">雇用保険料率（%）</Label>
          <Input
            id="employmentInsuranceRate"
            type="number"
            step="0.0001"
            {...register("employmentInsuranceRate", { valueAsNumber: true })}
          />
          {errors.employmentInsuranceRate && (
            <p className="text-sm text-destructive">{errors.employmentInsuranceRate.message}</p>
          )}
        </div>
      </div>
      <Button type="submit" disabled={isSubmitting}>
        {taxSetting ? "更新する" : "この年月から適用する"}
      </Button>
    </form>
  );
}
