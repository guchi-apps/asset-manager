// 年次税務の書き込み（サーバー専用）。認証は呼び出し側（`app/actions/tax.ts`）が済ませ、
// ここへは認証済みの userId だけが渡る。where には必ず userId を入れ、他ユーザーの行は触れない。
import { prisma } from "@/lib/prisma";
import { RESIDENT_TAX_BREAKDOWN_FIELDS, type ResidentTaxBreakdownField } from "./annual-tax";
import type { DeductionType } from "./types";

export async function saveDeductions(
  userId: string,
  year: number,
  amounts: Partial<Record<DeductionType, number>>
): Promise<void> {
  const entries = Object.entries(amounts) as [DeductionType, number][];
  await prisma.$transaction(
    entries.map(([deductionType, amount]) =>
      prisma.deduction.upsert({
        where: { userId_year_deductionType: { userId, year, deductionType } },
        create: { userId, year, deductionType, amount },
        update: { amount },
      })
    )
  );
}

/** 値のある項目は上書きを保存し、null の項目は上書きを解除する */
export async function saveOverrides(
  userId: string,
  year: number,
  values: Partial<Record<ResidentTaxBreakdownField, number | null>>
): Promise<void> {
  const entries = Object.entries(values) as [ResidentTaxBreakdownField, number | null][];
  await prisma.$transaction(
    entries.map(([field, amount]) =>
      amount === null
        ? prisma.taxCalculationOverride.deleteMany({ where: { userId, year, field } })
        : prisma.taxCalculationOverride.upsert({
            where: { userId_year_field: { userId, year, field } },
            create: { userId, year, field, amount },
            update: { amount },
          })
    )
  );
}

/** 全項目の値を上書きとして保存する（＝確定）。保存済みの値がある項目は置き換える */
export async function lockYear(
  userId: string,
  year: number,
  values: Record<ResidentTaxBreakdownField, number>
): Promise<void> {
  await saveOverrides(
    userId,
    year,
    Object.fromEntries(RESIDENT_TAX_BREAKDOWN_FIELDS.map((field) => [field, values[field]]))
  );
}

/** その年の上書きをすべて消す（確定の解除。保存済みの個別の上書きも消える） */
export async function unlockYear(userId: string, year: number): Promise<void> {
  await prisma.taxCalculationOverride.deleteMany({ where: { userId, year } });
}
