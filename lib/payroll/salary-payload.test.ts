// 給与の保存内容の組み立て（salary-payload.ts）の単体テスト。
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildSalaryPayload } from "./salary-payload";
import type { ResolvedSalaryInput, SalaryPayloadItem } from "./salary-payload";

const items: SalaryPayloadItem[] = [
  { id: "commute", itemName: "通勤手当", itemType: "earning" },
  { id: "travel", itemName: "出張旅費", itemType: "otherEarning" },
  { id: "taxable", itemName: "社宅の課税分", itemType: "otherTaxable" },
  { id: "kaigo", itemName: "介護保険", itemType: "statutoryDeduction" },
  { id: "union", itemName: "組合費", itemType: "deduction" },
  { id: "adjust", itemName: "年末調整", itemType: "deduction" },
];

const input: ResolvedSalaryInput = {
  salaryDate: "2026-09-25",
  baseSalary: 300000,
  overtimeHours: 8.5,
  overtimeAmount: 21500,
  standardMonthlyRemuneration: 440000,
  healthInsurance: 17300,
  pension: 39500,
  employmentInsurance: 1840,
  incomeTax: 7100,
  residentTax: 18000,
  customValues: { commute: 45000, travel: 2800, taxable: 5000, kaigo: 3000, union: 7000, adjust: -1200, gone: 999 },
};

describe("buildSalaryPayload", () => {
  const payload = buildSalaryPayload(input, items);

  it("支給額は支給・その他支給の合計で、その他(課税処理)は含めない", () => {
    assert.equal(payload.grossSalary, 300000 + 21500 + 45000 + 2800);
  });

  it("手取額は法定控除・控除を引く。年末調整は符号どおりに引く", () => {
    assert.equal(
      payload.netSalary,
      369300 - 17300 - 39500 - 1840 - 7100 - 18000 - 3000 - 7000 - -1200
    );
  });

  it("控除はマイナスで持ち、年末調整は符号を保つ。項目に無い id と 0 円は持たない", () => {
    assert.equal(payload.data.healthInsurance, -17300);
    assert.equal(payload.data.residentTax, -18000);
    assert.deepEqual(payload.data.customItemValues, {
      commute: 45000,
      travel: 2800,
      taxable: 5000,
      kaigo: -3000,
      union: -7000,
      adjust: -1200,
    });
    const zero = buildSalaryPayload({ ...input, customValues: { commute: 0 } }, items);
    assert.deepEqual(zero.data.customItemValues, {});
  });

  it("支給日はUTCの0時、空のメモは持たない", () => {
    assert.equal(payload.salaryDate, "2026-09-25T00:00:00.000Z");
    assert.equal(payload.memo, undefined);
    assert.equal(buildSalaryPayload({ ...input, memo: "メモ" }, items).memo, "メモ");
  });
});
