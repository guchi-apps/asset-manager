// 年次税務の保存入力の検証。サーバーアクションが受け取る値はクライアント由来なので、
// 種類・項目キー・金額の範囲をここで必ず確かめる（DB の Decimal(10, 2) に収まる範囲）。
import { z } from "zod";

import { RESIDENT_TAX_BREAKDOWN_FIELDS } from "./annual-tax";
import { DEDUCTION_TYPES } from "./types";

const MAX_AMOUNT = 99_999_999;

export const YearSchema = z.number().int().min(2000).max(2100);

const OverrideFieldSchema = z.enum(RESIDENT_TAX_BREAKDOWN_FIELDS);
const AmountSchema = z.number().finite().min(-MAX_AMOUNT).max(MAX_AMOUNT);

/** 年次控除。金額は0以上（控除の支払額・調整額に負の値は無い） */
export const SaveDeductionsSchema = z.object({
  year: YearSchema,
  amounts: z.partialRecord(z.enum(DEDUCTION_TYPES), z.number().finite().min(0).max(MAX_AMOUNT)),
});

/** 手動上書き。値が null の項目は上書きを解除する */
export const SaveOverridesSchema = z.object({
  year: YearSchema,
  values: z.partialRecord(OverrideFieldSchema, AmountSchema.nullable()),
});

/** 確定。全項目の値が揃っていなければ確定にならないため、欠けは拒否する（enum キーの record は全キー必須） */
export const LockYearSchema = z.object({
  year: YearSchema,
  values: z.record(OverrideFieldSchema, AmountSchema),
});

export function describeValidationError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "入力値が正しくありません";
}
