"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { toast } from "sonner";

import {
  calculateBonusWithholdingTax,
  calculateStandardBonusAmount,
  calculateStatutoryInsurance,
} from "@/lib/payroll/calculations";
import { INCOME_TAX_ADJUSTMENT_ITEM_NAMES } from "@/lib/payroll/types";
import { createBonusAction, updateBonusAction } from "@/app/actions/payroll";
import { resolveManualNumber } from "@/lib/payroll/calculations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/payroll/amount-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AutoCalcHint } from "@/components/payroll/auto-calc-hint";
import { ItemFieldLabel } from "@/components/payroll/item-field-label";
import type { BonusDTO, EditableItemDTO, ItemDTO, TaxSettingDTO } from "@/lib/payroll/types";

const bonusFormSchema = z.object({
  bonusDate: z.string().min(1, "支給日は必須です"),
  baseAmount: z.number().positive("支給額は0より大きい数値が必須"),
  attendanceAdjustedAmount: z.number().min(0).optional(),
  futureDesignReserveAmount: z.number().min(0).optional(),
  dcPensionContribution: z.number().min(0).optional(),
  standardBonusAmount: z.number().min(0).optional(),
  healthInsurance: z.number().min(0).optional(),
  pension: z.number().min(0).optional(),
  employmentInsurance: z.number().min(0).optional(),
  incomeTax: z.number().min(0).optional(),
  memo: z.string().optional(),
});

type BonusFormValues = z.infer<typeof bonusFormSchema>;

function parseDataNumber(data: Record<string, unknown> | undefined, key: string) {
  const value = data?.[key];
  return typeof value === "number" ? value : undefined;
}

function parseAbsDataNumber(data: Record<string, unknown> | undefined, key: string) {
  const value = parseDataNumber(data, key);
  return value === undefined ? undefined : Math.abs(value);
}

// 控除系項目(deduction/statutoryDeduction)は常にマイナスでDB保存されるため、
// フォーム表示用に符号を戻す。それ以外(otherEarning等)は正負どちらもあり得る値なので符号を保持する。
// 年末調整・所得税(差額)項目は控除系でも追加徴収/還付の両方があり得るため、符号を保持する。
function initialCustomValues(
  data: Record<string, unknown> | undefined,
  items: ItemDTO[]
): Record<string, number> {
  const raw = data?.customItemValues;
  if (!raw || typeof raw !== "object") return {};
  const itemById = new Map(items.map((item) => [item.id, item]));
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>)
      .filter((entry): entry is [string, number] => typeof entry[1] === "number")
      .map(([id, value]) => {
        const item = itemById.get(id);
        const isDeductionLike =
          (item?.itemType === "deduction" || item?.itemType === "statutoryDeduction") &&
          !INCOME_TAX_ADJUSTMENT_ITEM_NAMES.includes(item.itemName);
        return [id, isDeductionLike ? Math.abs(value) : value];
      })
  );
}

function toDateInputValue(iso: string): string {
  return format(new Date(iso), "yyyy-MM-dd");
}

export function BonusForm({
  bonus,
  taxSetting,
  items = [],
  previousMonthTaxableSalary,
}: {
  bonus?: BonusDTO;
  taxSetting?: TaxSettingDTO | null;
  items?: EditableItemDTO[];
  previousMonthTaxableSalary?: number;
}) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [customValues, setCustomValues] = useState<Record<string, number>>(() =>
    initialCustomValues(bonus?.data, items)
  );

  const earningItems = items.filter((item) => item.itemType === "earning");
  const otherEarningItems = items.filter((item) => item.itemType === "otherEarning");
  const otherTaxableItems = items.filter((item) => item.itemType === "otherTaxable");
  const statutoryDeductionItems = items.filter((item) => item.itemType === "statutoryDeduction");
  const deductionItems = items.filter((item) => item.itemType === "deduction");

  const healthInsuranceRate = taxSetting ? Number(taxSetting.healthInsuranceRate) : 9.15;
  const pensionRate = taxSetting ? Number(taxSetting.pensionRate) : 9.15;
  const employmentInsuranceRate = taxSetting ? Number(taxSetting.employmentInsuranceRate) : 0.6;

  const {
    control,
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<BonusFormValues>({
    resolver: zodResolver(bonusFormSchema),
    defaultValues: {
      bonusDate: bonus ? toDateInputValue(bonus.bonusDate) : "",
      baseAmount: parseDataNumber(bonus?.data, "baseAmount") ?? 0,
      attendanceAdjustedAmount: parseDataNumber(bonus?.data, "attendanceAdjustedAmount"),
      futureDesignReserveAmount: parseDataNumber(bonus?.data, "futureDesignReserveAmount"),
      dcPensionContribution: parseAbsDataNumber(bonus?.data, "dcPensionContribution"),
      standardBonusAmount: parseDataNumber(bonus?.data, "standardBonusAmount"),
      healthInsurance: parseAbsDataNumber(bonus?.data, "healthInsurance"),
      pension: parseAbsDataNumber(bonus?.data, "pension"),
      employmentInsurance: parseAbsDataNumber(bonus?.data, "employmentInsurance"),
      incomeTax: parseAbsDataNumber(bonus?.data, "incomeTax"),
      memo: bonus?.memo ?? "",
    },
  });

  const baseAmount = watch("baseAmount") || 0;
  const attendanceAdjustedAmount = watch("attendanceAdjustedAmount");
  const futureDesignReserveAmount = watch("futureDesignReserveAmount") || 0;
  const dcPensionContribution = watch("dcPensionContribution") || 0;
  const standardBonusAmount = watch("standardBonusAmount");
  const healthInsurance = watch("healthInsurance");
  const pension = watch("pension");
  const employmentInsurance = watch("employmentInsurance");
  const incomeTax = watch("incomeTax");

  function customTotal(categoryItems: ItemDTO[]) {
    return categoryItems.reduce((sum, item) => sum + (customValues[item.id] || 0), 0);
  }

  const customEarningTotal = customTotal(earningItems);
  const customOtherEarningTotal = customTotal(otherEarningItems);
  const customStatutoryDeductionTotal = customTotal(statutoryDeductionItems);
  const customDeductionTotal = customTotal(deductionItems);

  const resolvedAttendanceAdjustedAmount = resolveManualNumber(attendanceAdjustedAmount, baseAmount);

  const earningSectionTotal =
    resolvedAttendanceAdjustedAmount +
    futureDesignReserveAmount -
    dcPensionContribution +
    customEarningTotal;

  const grossAmount = earningSectionTotal + customOtherEarningTotal;

  const standardBonusAmountDefault = useMemo(
    () => calculateStandardBonusAmount(grossAmount),
    [grossAmount]
  );
  const resolvedStandardBonusAmount = resolveManualNumber(standardBonusAmount, standardBonusAmountDefault);

  const insuranceDefaults = useMemo(
    () =>
      calculateStatutoryInsurance({
        standardAmount: resolvedStandardBonusAmount,
        grossPay: grossAmount,
        healthInsuranceRate,
        pensionRate,
        employmentInsuranceRate,
      }),
    [resolvedStandardBonusAmount, grossAmount, healthInsuranceRate, pensionRate, employmentInsuranceRate]
  );

  const resolvedHealthInsurance = resolveManualNumber(healthInsurance, insuranceDefaults.healthInsurance);
  const resolvedPension = resolveManualNumber(pension, insuranceDefaults.pension);
  const resolvedEmploymentInsurance = resolveManualNumber(
    employmentInsurance,
    insuranceDefaults.employmentInsurance
  );

  const nonTaxableEarningTotal = useMemo(
    () =>
      [...earningItems, ...otherEarningItems]
        .filter((item) => !item.isTaxable)
        .reduce((sum, item) => sum + (customValues[item.id] || 0), 0),
    [earningItems, otherEarningItems, customValues]
  );
  const customOtherTaxableTotal = customTotal(otherTaxableItems);

  const bonusTaxableBase =
    grossAmount -
    resolvedHealthInsurance -
    resolvedPension -
    resolvedEmploymentInsurance -
    nonTaxableEarningTotal +
    customOtherTaxableTotal;
  const incomeTaxAuto =
    previousMonthTaxableSalary !== undefined
      ? calculateBonusWithholdingTax(previousMonthTaxableSalary, bonusTaxableBase)
      : undefined;
  const resolvedIncomeTax = resolveManualNumber(incomeTax, incomeTaxAuto ?? 0);

  const statutoryDeductionSectionTotal =
    resolvedHealthInsurance +
    resolvedPension +
    resolvedEmploymentInsurance +
    resolvedIncomeTax +
    customStatutoryDeductionTotal;
  const deductionSectionTotal = customDeductionTotal;

  const netAmount =
    grossAmount -
    resolvedHealthInsurance -
    resolvedPension -
    resolvedEmploymentInsurance -
    resolvedIncomeTax -
    customStatutoryDeductionTotal -
    customDeductionTotal;

  function handleCustomValueChange(itemId: string, value: number | undefined) {
    setCustomValues((prev) => ({ ...prev, [itemId]: value ?? 0 }));
  }

  async function onSubmit(values: BonusFormValues) {
    setIsSubmitting(true);
    try {
      const customItemValues = Object.fromEntries(
        items
          .map((item) => {
            const amount = customValues[item.id] || 0;
            const isDeductionLike =
              (item.itemType === "deduction" || item.itemType === "statutoryDeduction") &&
              !INCOME_TAX_ADJUSTMENT_ITEM_NAMES.includes(item.itemName);
            return [item.id, isDeductionLike ? -amount : amount] as const;
          })
          .filter(([, amount]) => amount !== 0)
      );

      const payload = {
        bonusDate: new Date(values.bonusDate).toISOString(),
        amount: grossAmount,
        memo: values.memo || undefined,
        data: {
          baseAmount: values.baseAmount,
          attendanceAdjustedAmount: resolvedAttendanceAdjustedAmount,
          futureDesignReserveAmount,
          dcPensionContribution: -dcPensionContribution,
          standardBonusAmount: resolvedStandardBonusAmount,
          healthInsurance: -resolvedHealthInsurance,
          pension: -resolvedPension,
          employmentInsurance: -resolvedEmploymentInsurance,
          incomeTax: -resolvedIncomeTax,
          netAmount,
          customItemValues,
        },
      };

      // 同じ支給日の明細がすでにあれば保存されず、理由が返る（既存の明細は変わらない）
      const result = bonus ? await updateBonusAction(bonus.id, payload) : await createBonusAction(payload);
      if (!result.success) {
        toast.error(result.error);
        return;
      }

      toast.success(bonus ? "賞与を更新しました" : "賞与を登録しました");
      router.push("/bonuses");
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="max-w-xl space-y-6">
      <div className="space-y-1.5">
        <Label htmlFor="bonusDate">支給日</Label>
        <Input id="bonusDate" type="date" {...register("bonusDate")} />
        {errors.bonusDate && <p className="text-sm text-destructive">{errors.bonusDate.message}</p>}
      </div>

      <div className="space-y-3 rounded-md border p-3">
        <p className="text-sm font-medium">支給</p>
        <div className="space-y-1.5">
          <Label htmlFor="baseAmount">賞与支給額</Label>
          <Controller
            control={control}
            name="baseAmount"
            render={({ field }) => (
              <AmountInput id="baseAmount" value={field.value} onChange={field.onChange} />
            )}
          />
          {errors.baseAmount && <p className="text-sm text-destructive">{errors.baseAmount.message}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="attendanceAdjustedAmount">賞与支給(勤怠減額後)</Label>
          <Controller
            control={control}
            name="attendanceAdjustedAmount"
            render={({ field }) => (
              <AmountInput
                id="attendanceAdjustedAmount"
                placeholder={baseAmount.toLocaleString()}
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
          <AutoCalcHint manualValue={attendanceAdjustedAmount} autoValue={baseAmount} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="futureDesignReserveAmount">将来設計準備金基準額</Label>
            <Controller
              control={control}
              name="futureDesignReserveAmount"
              render={({ field }) => (
                <AmountInput
                  id="futureDesignReserveAmount"
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dcPensionContribution">(-) 確定拠出年金掛金</Label>
            <Controller
              control={control}
              name="dcPensionContribution"
              render={({ field }) => (
                <AmountInput
                  id="dcPensionContribution"
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </div>
        </div>

        {earningItems.length > 0 && (
          <div className="grid grid-cols-2 gap-4">
            {earningItems.map((item) => (
              <div key={item.id} className="space-y-1.5">
                <ItemFieldLabel item={item} />
                <AmountInput
                  id={`custom-${item.id}`}
                  value={customValues[item.id]}
                  onChange={(value) => handleCustomValueChange(item.id, value)}
                />
              </div>
            ))}
          </div>
        )}
        <div className="flex justify-between border-t pt-2 text-sm font-medium">
          <span>支給 小計</span>
          <span>{earningSectionTotal.toLocaleString()} 円</span>
        </div>
      </div>

      {otherEarningItems.length > 0 && (
        <div className="space-y-3 rounded-md border p-3">
          <p className="text-sm font-medium">その他支給</p>
          <div className="grid grid-cols-2 gap-4">
            {otherEarningItems.map((item) => (
              <div key={item.id} className="space-y-1.5">
                <ItemFieldLabel item={item} />
                <AmountInput
                  id={`custom-${item.id}`}
                  value={customValues[item.id]}
                  onChange={(value) => handleCustomValueChange(item.id, value)}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between border-t pt-2 text-sm font-medium">
            <span>その他支給 小計</span>
            <span>{customOtherEarningTotal.toLocaleString()} 円</span>
          </div>
        </div>
      )}

      {otherTaxableItems.length > 0 && (
        <div className="space-y-3 rounded-md border p-3">
          <p className="text-sm font-medium">その他(課税処理)</p>
          <p className="text-xs text-muted-foreground">
            支給額には含めず、所得税の課税対象額にのみ加算されます。
          </p>
          <div className="grid grid-cols-2 gap-4">
            {otherTaxableItems.map((item) => (
              <div key={item.id} className="space-y-1.5">
                <ItemFieldLabel item={item} />
                <AmountInput
                  id={`custom-${item.id}`}
                  value={customValues[item.id]}
                  onChange={(value) => handleCustomValueChange(item.id, value)}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3 rounded-md border p-3">
        <p className="text-sm font-medium">法定控除</p>
        <div className="space-y-1.5">
          <Label htmlFor="standardBonusAmount">標準賞与額</Label>
          <Controller
            control={control}
            name="standardBonusAmount"
            render={({ field }) => (
              <AmountInput
                id="standardBonusAmount"
                placeholder={standardBonusAmountDefault.toLocaleString()}
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
          <p className="text-xs text-muted-foreground">
            自動計算: 支給総合計の1,000円未満を切り捨てた額（{standardBonusAmountDefault.toLocaleString()} 円）
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="healthInsurance">健康保険料</Label>
            <Controller
              control={control}
              name="healthInsurance"
              render={({ field }) => (
                <AmountInput
                  id="healthInsurance"
                  placeholder={insuranceDefaults.healthInsurance.toLocaleString()}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
            <AutoCalcHint manualValue={healthInsurance} autoValue={insuranceDefaults.healthInsurance} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pension">厚生年金保険料</Label>
            <Controller
              control={control}
              name="pension"
              render={({ field }) => (
                <AmountInput
                  id="pension"
                  placeholder={insuranceDefaults.pension.toLocaleString()}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
            <AutoCalcHint manualValue={pension} autoValue={insuranceDefaults.pension} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="employmentInsurance">雇用保険料</Label>
            <Controller
              control={control}
              name="employmentInsurance"
              render={({ field }) => (
                <AmountInput
                  id="employmentInsurance"
                  placeholder={insuranceDefaults.employmentInsurance.toLocaleString()}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
            <AutoCalcHint
              manualValue={employmentInsurance}
              autoValue={insuranceDefaults.employmentInsurance}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="incomeTax">所得税</Label>
            <Controller
              control={control}
              name="incomeTax"
              render={({ field }) => (
                <AmountInput
                  id="incomeTax"
                  placeholder={incomeTaxAuto !== undefined ? incomeTaxAuto.toLocaleString() : undefined}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
            {incomeTaxAuto !== undefined ? (
              <AutoCalcHint manualValue={incomeTax} autoValue={incomeTaxAuto} />
            ) : (
              <p className="text-xs text-muted-foreground">
                前月の給与が登録されていないため自動計算できません。
              </p>
            )}
          </div>
        </div>

        {statutoryDeductionItems.length > 0 && (
          <div className="grid grid-cols-2 gap-4">
            {statutoryDeductionItems.map((item) => (
              <div key={item.id} className="space-y-1.5">
                <ItemFieldLabel item={item} />
                <AmountInput
                  id={`custom-${item.id}`}
                  value={customValues[item.id]}
                  onChange={(value) => handleCustomValueChange(item.id, value)}
                />
              </div>
            ))}
          </div>
        )}
        <div className="flex justify-between border-t pt-2 text-sm font-medium">
          <span>法定控除 小計</span>
          <span>{statutoryDeductionSectionTotal.toLocaleString()} 円</span>
        </div>
      </div>

      <div className="space-y-3 rounded-md border p-3">
        <p className="text-sm font-medium">控除</p>

        {deductionItems.length > 0 && (
          <div className="grid grid-cols-2 gap-4">
            {deductionItems.map((item) => (
              <div key={item.id} className="space-y-1.5">
                <ItemFieldLabel item={item} />
                <AmountInput
                  id={`custom-${item.id}`}
                  value={customValues[item.id]}
                  onChange={(value) => handleCustomValueChange(item.id, value)}
                />
              </div>
            ))}
          </div>
        )}
        <div className="flex justify-between border-t pt-2 text-sm font-medium">
          <span>控除 小計</span>
          <span>{deductionSectionTotal.toLocaleString()} 円</span>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="memo">メモ</Label>
        <Textarea id="memo" {...register("memo")} />
      </div>

      <div className="rounded-md border bg-muted/40 p-4 text-sm">
        <div className="flex justify-between">
          <span>支給額</span>
          <span className="font-medium">{grossAmount.toLocaleString()} 円</span>
        </div>
        <div className="flex justify-between">
          <span>控除合計</span>
          <span className="font-medium">
            {(statutoryDeductionSectionTotal + deductionSectionTotal).toLocaleString()} 円
          </span>
        </div>
        <div className="flex justify-between">
          <span>手取額</span>
          <span className="font-medium">{netAmount.toLocaleString()} 円</span>
        </div>
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {bonus ? "更新する" : "登録する"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          キャンセル
        </Button>
      </div>
    </form>
  );
}
