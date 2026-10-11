// 給与・賞与の内訳・推移の集計（chart-data.ts）の単体テスト（#714）。
// 明細ラボと同じ明細データから同じ支給・控除の内訳と年別合計になることを確かめる。
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildDeductionItems,
  buildDeductionRow,
  buildSalaryEarningRow,
  buildSalaryOtherEarningItems,
  buildStatutoryDeductionItems,
  groupRowsByYear,
  sumBreakdownItems,
  sumRecords,
} from "./chart-data";
import type { ItemDTO } from "./types";

function item(id: string, itemName: string, itemType: ItemDTO["itemType"]): ItemDTO {
  return {
    id,
    userId: "u1",
    itemName,
    itemType,
    scope: "both",
    isTaxable: true,
    displayOrder: 0,
    isActive: true,
    createdAt: "",
    updatedAt: "",
  };
}

const items = [
  item("commute", "通勤手当", "earning"),
  item("remote", "在宅勤務手当", "earning"),
  item("settle", "精算", "otherEarning"),
  item("zaikei", "財形貯蓄", "deduction"),
  item("nencho", "年末調整", "statutoryDeduction"),
];

const data = {
  baseGrossSalary: 310000,
  overtime: 28400,
  healthInsurance: -18300,
  pension: -32940,
  employmentInsurance: -2168,
  incomeTax: -9182,
  residentTax: -21900,
  customItemValues: { commute: 16000, remote: 7000, settle: -1200, zaikei: -8000, nencho: 3000 },
};

describe("給与の内訳", () => {
  it("支給は本給・超勤・通勤手当・その他支給に分かれる", () => {
    assert.deepEqual(buildSalaryEarningRow(data, items), {
      本給: 310000,
      超勤手当: 28400,
      通勤手当: 16000,
      その他支給: 5800,
    });
  });

  it("その他支給の内訳は符号を保つ（精算のマイナスがそのまま出る）", () => {
    assert.deepEqual(buildSalaryOtherEarningItems(data, items), [
      { name: "在宅勤務手当", value: 7000 },
      { name: "精算", value: -1200 },
    ]);
  });

  it("控除は絶対値で集計し、年末調整は符号を保つ", () => {
    assert.deepEqual(buildDeductionRow(data, items), { 法定控除: 81490, 控除: 8000 });
    assert.deepEqual(buildStatutoryDeductionItems(data, items).at(-1), { name: "年末調整", value: 3000 });
    assert.deepEqual(buildDeductionItems(data, items), [{ name: "財形貯蓄", value: 8000 }]);
  });
});

describe("年別の合算", () => {
  it("同じ年の行を合算し、年の昇順に並べる", () => {
    const rows = [
      { date: new Date(2025, 11, 25), values: { a: 1, b: 2 } },
      { date: new Date(2026, 0, 25), values: { a: 10, b: 20 } },
      { date: new Date(2026, 1, 25), values: { a: 100, b: 200 } },
    ];
    assert.deepEqual(
      groupRowsByYear(rows).map((row) => [row.date.getFullYear(), row.values]),
      [
        [2025, { a: 1, b: 2 }],
        [2026, { a: 110, b: 220 }],
      ]
    );
  });

  it("内訳を名前ごとに合算する", () => {
    assert.deepEqual(sumRecords([{ x: 1 }, { x: 2 }]), { x: 3 });
    assert.deepEqual(
      sumBreakdownItems([[{ name: "財形", value: 8000 }], [{ name: "財形", value: 8000 }, { name: "互助会", value: 500 }]]),
      [
        { name: "財形", value: 16000 },
        { name: "互助会", value: 500 },
      ]
    );
  });
});
