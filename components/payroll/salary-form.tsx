"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { toast } from "sonner";

import {
  calculateOvertime,
  calculateStatutoryInsurance,
  calculateWithholdingIncomeTax,
} from "@/lib/payroll/calculations";
import { INCOME_TAX_ADJUSTMENT_ITEM_NAMES } from "@/lib/payroll/types";
import { createSalaryAction, updateSalaryAction } from "@/app/actions/payroll";
import { resolveManualNumber } from "@/lib/payroll/calculations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/payroll/amount-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AutoCalcHint } from "@/components/payroll/auto-calc-hint";
import { ItemFieldLabel, PdfMark } from "@/components/payroll/item-field-label";
import { PayslipPdfImport } from "@/components/payroll/payslip-pdf-import";
import type { PayslipFormValues } from "@/lib/payroll/payslip-pdf";
import type { EditableItemDTO, ItemDTO, SalaryDTO, TaxSettingDTO } from "@/lib/payroll/types";

const salaryFormSchema = z.object({
  salaryDate: z.string().min(1, "支給日は必須です"),
  baseSalary: z.number().positive("基本給は0より大きい数値が必須"),
  overtimeHours: z.number().min(0).optional(),
  overtimeAmount: z.number().min(0).optional(),
  standardMonthlyRemuneration: z.number().min(0).optional(),
  healthInsurance: z.number().min(0).optional(),
  pension: z.number().min(0).optional(),
  employmentInsurance: z.number().min(0).optional(),
  incomeTax: z.number().min(0).optional(),
  residentTax: z.number().min(0).optional(),
  memo: z.string().optional(),
});

type SalaryFormValues = z.infer<typeof salaryFormSchema>;

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
function extractCustomItemValues(
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

function initialCustomValues(
  data: Record<string, unknown> | undefined,
  previousData: Record<string, unknown> | undefined,
  isEditing: boolean,
  items: ItemDTO[]
): Record<string, number> {
  if (isEditing) return extractCustomItemValues(data, items);
  return { ...extractCustomItemValues(previousData, items), ...extractCustomItemValues(data, items) };
}

function toDateInputValue(iso: string): string {
  return format(new Date(iso), "yyyy-MM-dd");
}

export function SalaryForm({
  salary,
  taxSetting,
  items = [],
  previousStandardMonthlyRemuneration,
  previousSalaryData,
  pdfImportPayday,
}: {
  salary?: SalaryDTO;
  taxSetting?: TaxSettingDTO | null;
  items?: EditableItemDTO[];
  previousStandardMonthlyRemuneration?: number;
  previousSalaryData?: Record<string, unknown>;
  /** 指定するとPDF取り込みのカードを出す。PDFには年月しか無いため、支給日の「日」に使う */
  pdfImportPayday?: number;
}) {
  const router = useRouter();
  const isEditing = Boolean(salary);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [customValues, setCustomValues] = useState<Record<string, number>>(() =>
    initialCustomValues(salary?.data, previousSalaryData, isEditing, items)
  );
  const [pdfApplied, setPdfApplied] = useState<Set<string>>(() => new Set());

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
    setValue,
    watch,
    formState: { errors },
  } = useForm<SalaryFormValues>({
    resolver: zodResolver(salaryFormSchema),
    defaultValues: {
      salaryDate: salary ? toDateInputValue(salary.salaryDate) : toDateInputValue(new Date().toISOString()),
      baseSalary:
        parseDataNumber(salary?.data, "baseGrossSalary") ??
        (isEditing ? undefined : parseDataNumber(previousSalaryData, "baseGrossSalary")),
      overtimeHours: parseDataNumber(salary?.data, "overtimeHours") ?? 0,
      overtimeAmount: parseDataNumber(salary?.data, "overtime"),
      standardMonthlyRemuneration:
        parseDataNumber(salary?.data, "standardMonthlyRemuneration") ??
        (isEditing ? undefined : previousStandardMonthlyRemuneration) ??
        0,
      healthInsurance: parseAbsDataNumber(salary?.data, "healthInsurance"),
      pension: parseAbsDataNumber(salary?.data, "pension"),
      employmentInsurance: parseAbsDataNumber(salary?.data, "employmentInsurance"),
      incomeTax: parseAbsDataNumber(salary?.data, "incomeTax"),
      residentTax: parseAbsDataNumber(salary?.data, "residentTax"),
      memo: salary?.memo ?? "",
    },
  });

  const baseSalary = watch("baseSalary") || 0;
  const overtimeHours = watch("overtimeHours") || 0;
  const overtimeAmount = watch("overtimeAmount");
  const standardMonthlyRemuneration = watch("standardMonthlyRemuneration") || 0;
  const healthInsurance = watch("healthInsurance");
  const pension = watch("pension");
  const employmentInsurance = watch("employmentInsurance");
  const incomeTax = watch("incomeTax");
  const residentTax = watch("residentTax");

  const overtime = useMemo(
    () => calculateOvertime({ baseSalary, overtimeHours }),
    [baseSalary, overtimeHours]
  );
  const previousOvertimeAmount = parseDataNumber(previousSalaryData, "overtime");
  const overtimeAmountPlaceholder = overtimeHours > 0 ? overtime.overtimeAmount : previousOvertimeAmount;
  const resolvedOvertimeAmount = resolveManualNumber(
    overtimeAmount,
    overtimeHours > 0 ? overtime.overtimeAmount : previousOvertimeAmount ?? 0
  );

  function customTotal(categoryItems: ItemDTO[]) {
    return categoryItems.reduce((sum, item) => sum + (customValues[item.id] || 0), 0);
  }

  const customEarningTotal = customTotal(earningItems);
  const customOtherEarningTotal = customTotal(otherEarningItems);
  const customOtherTaxableTotal = customTotal(otherTaxableItems);
  const customStatutoryDeductionTotal = customTotal(statutoryDeductionItems);
  const customDeductionTotal = customTotal(deductionItems);

  const earningSectionTotal = baseSalary + resolvedOvertimeAmount + customEarningTotal;

  const grossSalary = earningSectionTotal + customOtherEarningTotal;

  const insuranceDefaults = useMemo(
    () =>
      calculateStatutoryInsurance({
        standardAmount: standardMonthlyRemuneration,
        grossPay: earningSectionTotal,
        healthInsuranceRate,
        pensionRate,
        employmentInsuranceRate,
      }),
    [standardMonthlyRemuneration, earningSectionTotal, healthInsuranceRate, pensionRate, employmentInsuranceRate]
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

  const taxableBase =
    grossSalary -
    resolvedHealthInsurance -
    resolvedPension -
    resolvedEmploymentInsurance -
    nonTaxableEarningTotal +
    customOtherTaxableTotal;
  const incomeTaxAuto = useMemo(
    () => calculateWithholdingIncomeTax(taxableBase),
    [taxableBase]
  );
  const resolvedIncomeTax = resolveManualNumber(incomeTax, incomeTaxAuto);

  // 住民税の自動計算の目安は年次税務データ（#716で移管）から出すため、それまでは手入力の値だけを使う
  const resolvedResidentTax = resolveManualNumber(residentTax, 0);

  const statutoryDeductionSectionTotal =
    resolvedHealthInsurance +
    resolvedPension +
    resolvedEmploymentInsurance +
    resolvedIncomeTax +
    resolvedResidentTax +
    customStatutoryDeductionTotal;
  const deductionSectionTotal = customDeductionTotal;

  const netSalary =
    grossSalary -
    resolvedHealthInsurance -
    resolvedPension -
    resolvedEmploymentInsurance -
    resolvedIncomeTax -
    resolvedResidentTax -
    customStatutoryDeductionTotal -
    customDeductionTotal;

  function handleCustomValueChange(itemId: string, value: number | undefined) {
    setCustomValues((prev) => ({ ...prev, [itemId]: value ?? 0 }));
  }

  function applyPdf(values: PayslipFormValues) {
    if (values.salaryDate) setValue("salaryDate", values.salaryDate, { shouldValidate: true });
    for (const [field, value] of Object.entries(values.fields)) {
      setValue(field as keyof SalaryFormValues, value, { shouldValidate: true });
    }
    setCustomValues(values.customValues);
    setPdfApplied(new Set(values.applied));
  }

  async function onSubmit(values: SalaryFormValues) {
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
        salaryDate: new Date(values.salaryDate).toISOString(),
        grossSalary,
        netSalary,
        memo: values.memo || undefined,
        data: {
          baseGrossSalary: values.baseSalary,
          overtimeHours: values.overtimeHours ?? 0,
          overtime: resolvedOvertimeAmount,
          standardMonthlyRemuneration: values.standardMonthlyRemuneration ?? 0,
          healthInsurance: -resolvedHealthInsurance,
          pension: -resolvedPension,
          employmentInsurance: -resolvedEmploymentInsurance,
          incomeTax: -resolvedIncomeTax,
          residentTax: -resolvedResidentTax,
          customItemValues,
        },
      };

      // 同じ支給日の明細がすでにあれば保存されず、理由が返る（既存の明細は変わらない）
      const result = salary ? await updateSalaryAction(salary.id, payload) : await createSalaryAction(payload);
      if (!result.success) {
        toast.error(result.error);
        return;
      }

      toast.success(salary ? "給与を更新しました" : "給与を登録しました");
      router.push("/salaries");
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  const form = (
    <form onSubmit={handleSubmit(onSubmit)} className="max-w-xl space-y-6">
      <div className="space-y-1.5">
        <Label htmlFor="salaryDate">
          支給日
          <PdfMark show={pdfApplied.has("salaryDate")} />
        </Label>
        <Input id="salaryDate" type="date" {...register("salaryDate")} />
        {errors.salaryDate && <p className="text-sm text-destructive">{errors.salaryDate.message}</p>}
      </div>

      <div className="space-y-3 rounded-md border p-3">
        <p className="text-sm font-medium">支給</p>
        <div className="space-y-1.5">
          <Label htmlFor="baseSalary">
            基本給
            <PdfMark show={pdfApplied.has("baseSalary")} />
          </Label>
          <Controller
            control={control}
            name="baseSalary"
            render={({ field }) => (
              <AmountInput id="baseSalary" value={field.value} onChange={field.onChange} />
            )}
          />
          {errors.baseSalary && <p className="text-sm text-destructive">{errors.baseSalary.message}</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="overtimeAmount">
              超勤手当
              <PdfMark show={pdfApplied.has("overtimeAmount")} />
            </Label>
            <Controller
              control={control}
              name="overtimeAmount"
              render={({ field }) => (
                <AmountInput
                  id="overtimeAmount"
                  placeholder={
                    overtimeAmountPlaceholder !== undefined
                      ? overtimeAmountPlaceholder.toLocaleString()
                      : undefined
                  }
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="overtimeHours">
              残業時間(h)
              <PdfMark show={pdfApplied.has("overtimeHours")} />
            </Label>
            <Controller
              control={control}
              name="overtimeHours"
              render={({ field }) => (
                <AmountInput id="overtimeHours" value={field.value} onChange={field.onChange} />
              )}
            />
          </div>
        </div>
        {overtimeHours > 0 && overtimeAmount !== undefined && !Number.isNaN(overtimeAmount) && (
          <p className="text-xs text-muted-foreground">
            時給換算: {(Math.round((overtimeAmount / overtimeHours) * 100) / 100).toLocaleString()} 円
          </p>
        )}

        {earningItems.length > 0 && (
          <div className="grid grid-cols-2 gap-4">
            {earningItems.map((item) => (
              <div key={item.id} className="space-y-1.5">
                <ItemFieldLabel item={item} fromPdf={pdfApplied.has(`item:${item.id}`)} />
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
                <ItemFieldLabel item={item} fromPdf={pdfApplied.has(`item:${item.id}`)} />
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
                <ItemFieldLabel item={item} fromPdf={pdfApplied.has(`item:${item.id}`)} />
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
          <Label htmlFor="standardMonthlyRemuneration">
            標準報酬月額
            <PdfMark show={pdfApplied.has("standardMonthlyRemuneration")} />
          </Label>
          <Controller
            control={control}
            name="standardMonthlyRemuneration"
            render={({ field }) => (
              <AmountInput id="standardMonthlyRemuneration" value={field.value} onChange={field.onChange} />
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="healthInsurance">
              健康保険料
              <PdfMark show={pdfApplied.has("healthInsurance")} />
            </Label>
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
            <Label htmlFor="pension">
              厚生年金保険料
              <PdfMark show={pdfApplied.has("pension")} />
            </Label>
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
            <Label htmlFor="employmentInsurance">
              雇用保険料
              <PdfMark show={pdfApplied.has("employmentInsurance")} />
            </Label>
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
            <Label htmlFor="incomeTax">
              所得税
              <PdfMark show={pdfApplied.has("incomeTax")} />
            </Label>
            <Controller
              control={control}
              name="incomeTax"
              render={({ field }) => (
                <AmountInput
                  id="incomeTax"
                  placeholder={incomeTaxAuto.toLocaleString()}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
            <AutoCalcHint manualValue={incomeTax} autoValue={incomeTaxAuto} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="residentTax">
              住民税
              <PdfMark show={pdfApplied.has("residentTax")} />
            </Label>
            <Controller
              control={control}
              name="residentTax"
              render={({ field }) => (
                <AmountInput id="residentTax" value={field.value} onChange={field.onChange} />
              )}
            />
          </div>
        </div>

        {statutoryDeductionItems.length > 0 && (
          <div className="grid grid-cols-2 gap-4">
            {statutoryDeductionItems.map((item) => (
              <div key={item.id} className="space-y-1.5">
                <ItemFieldLabel item={item} fromPdf={pdfApplied.has(`item:${item.id}`)} />
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
                <ItemFieldLabel item={item} fromPdf={pdfApplied.has(`item:${item.id}`)} />
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
          <span className="font-medium">{grossSalary.toLocaleString()} 円</span>
        </div>
        <div className="flex justify-between">
          <span>控除合計</span>
          <span className="font-medium">
            {(statutoryDeductionSectionTotal + deductionSectionTotal).toLocaleString()} 円
          </span>
        </div>
        <div className="flex justify-between">
          <span>手取額</span>
          <span className="font-medium">{netSalary.toLocaleString()} 円</span>
        </div>
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {salary ? "更新する" : "登録する"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          キャンセル
        </Button>
      </div>
    </form>
  );

  if (pdfImportPayday === undefined) return form;
  return (
    <div className="space-y-6">
      <PayslipPdfImport items={items} payday={pdfImportPayday} onApply={applyPdf} />
      {form}
    </div>
  );
}
