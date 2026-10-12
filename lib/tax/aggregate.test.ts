// 給与・賞与の明細行 → 年間集計・ふるさと納税見込み（annualTaxAggregate.ts）の単体テスト。
// DB は使わず、Prisma が返す行と同じ形のデータを直接渡す。
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeAnnualAggregate, computeFurusatoNozeiIncomeProjection } from "./aggregate";
import type { CurrentItems } from "./aggregate";
import type { ItemDefinition } from "../payroll/item-snapshot";

const COMMUTE = "item-commute";
const YEAR_END_ADJUSTMENT = "item-year-end";
const DIFF = "item-income-tax-diff";
const OTHER = "item-other";

const currentItems: CurrentItems = new Map<string, ItemDefinition>([
  [COMMUTE, { itemName: "通勤手当", itemType: "earning", isTaxable: false }],
  [YEAR_END_ADJUSTMENT, { itemName: "年末調整", itemType: "otherEarning", isTaxable: true }],
  [DIFF, { itemName: "所得税(差額)", itemType: "deduction", isTaxable: true }],
  [OTHER, { itemName: "その他手当", itemType: "earning", isTaxable: true }],
]);

// Prisma の Decimal は Number() で数値になるため、valueOf を持つオブジェクトで代用する
const decimal = (n: number) => ({ valueOf: () => n });

const salary = (month: number, grossSalary: number, data: unknown = {}, day = 25) => ({
  salaryDate: new Date(2025, month - 1, day),
  grossSalary: decimal(grossSalary),
  data,
});
const bonus = (year: number, month: number, amount: number, data: unknown = {}) => ({
  bonusDate: new Date(year, month - 1, 10),
  amount: decimal(amount),
  data,
});

describe("computeAnnualAggregate", () => {
  it("明細が無ければすべて0", () => {
    assert.deepEqual(computeAnnualAggregate([], [], currentItems), {
      grossIncome: 0,
      socialInsuranceTotal: 0,
      incomeTaxWithheldTotal: 0,
      salaryCount: 0,
      bonusCount: 0,
    });
  });

  it("給与と賞与の支給額を合計し、件数を数える", () => {
    const r = computeAnnualAggregate(
      [salary(1, 300000), salary(2, 310000)],
      [bonus(2025, 6, 500000)],
      currentItems
    );
    assert.equal(r.grossIncome, 1110000);
    assert.equal(r.salaryCount, 2);
    assert.equal(r.bonusCount, 1);
  });

  it("社会保険料は健康保険・厚生年金・雇用保険の絶対値を、給与と賞与の両方から合計する", () => {
    // 控除項目はマイナスで保存されている明細もあるため、符号に依らず絶対値で足す
    const r = computeAnnualAggregate(
      [salary(1, 300000, { healthInsurance: -15000, pension: 27000, employmentInsurance: 1800 })],
      [bonus(2025, 6, 500000, { healthInsurance: 25000, pension: -45000 })],
      currentItems
    );
    assert.equal(r.socialInsuranceTotal, 15000 + 27000 + 1800 + 25000 + 45000);
  });

  it("数値でない・欠けている項目は0として扱う", () => {
    const r = computeAnnualAggregate(
      [salary(1, 300000, { healthInsurance: "15000", pension: null }), salary(2, 300000, null)],
      [],
      currentItems
    );
    assert.equal(r.socialInsuranceTotal, 0);
    assert.equal(r.incomeTaxWithheldTotal, 0);
  });

  describe("非課税の支給項目（通勤手当など）", () => {
    it("支給額に含まれていても、収入金額（grossIncome）からは除く", () => {
      const r = computeAnnualAggregate(
        [salary(1, 310000, { customItemValues: { [COMMUTE]: 10000 } })],
        [],
        currentItems
      );
      assert.equal(r.grossIncome, 300000);
    });

    it("非課税項目の金額がマイナスで保存されていても、絶対値で除く", () => {
      const r = computeAnnualAggregate(
        [salary(1, 310000, { customItemValues: { [COMMUTE]: -10000 } })],
        [],
        currentItems
      );
      assert.equal(r.grossIncome, 300000);
    });

    it("賞与に含まれる非課税項目も除く", () => {
      const r = computeAnnualAggregate(
        [],
        [bonus(2025, 6, 500000, { customItemValues: { [COMMUTE]: 20000 } })],
        currentItems
      );
      assert.equal(r.grossIncome, 480000);
    });

    it("課税の支給項目は除かない", () => {
      const r = computeAnnualAggregate(
        [salary(1, 310000, { customItemValues: { [OTHER]: 10000 } })],
        [],
        currentItems
      );
      assert.equal(r.grossIncome, 310000);
    });

    it("控除項目（itemType が earning / otherEarning 以外）は非課税でも収入から引かない", () => {
      const items: CurrentItems = new Map([
        ["item-deduction", { itemName: "組合費", itemType: "deduction", isTaxable: false }],
      ]);
      const r = computeAnnualAggregate(
        [salary(1, 300000, { customItemValues: { "item-deduction": 5000 } })],
        [],
        items
      );
      assert.equal(r.grossIncome, 300000);
    });

    it("明細に保存した項目の写し（itemSnapshots）を現在のマスタより優先する（#212）", () => {
      // 現在のマスタでは通勤手当が非課税でも、保存時に課税だった明細は課税として集計する
      const r = computeAnnualAggregate(
        [
          salary(1, 310000, {
            customItemValues: { [COMMUTE]: 10000 },
            itemSnapshots: {
              [COMMUTE]: { itemName: "通勤手当", itemType: "earning", isTaxable: true },
            },
          }),
        ],
        [],
        currentItems
      );
      assert.equal(r.grossIncome, 310000);
    });

    it("マスタから削除された項目でも、写しがあれば非課税として除く", () => {
      const r = computeAnnualAggregate(
        [
          salary(1, 310000, {
            customItemValues: { gone: 10000 },
            itemSnapshots: { gone: { itemName: "旧手当", itemType: "earning", isTaxable: false } },
          }),
        ],
        [],
        new Map()
      );
      assert.equal(r.grossIncome, 300000);
    });
  });

  describe("源泉徴収税額", () => {
    it("所得税の絶対値を給与・賞与から合計する", () => {
      const r = computeAnnualAggregate(
        [salary(1, 300000, { incomeTax: -6000 }), salary(2, 300000, { incomeTax: 6000 })],
        [bonus(2025, 6, 500000, { incomeTax: -15000 })],
        currentItems
      );
      assert.equal(r.incomeTaxWithheldTotal, 27000);
    });

    it("年末調整で追加徴収（マイナス保存）なら、源泉徴収の合計に加える", () => {
      const r = computeAnnualAggregate(
        [salary(12, 300000, { incomeTax: -6000, customItemValues: { [YEAR_END_ADJUSTMENT]: -30000 } })],
        [],
        currentItems
      );
      assert.equal(r.incomeTaxWithheldTotal, 6000 + 30000);
    });

    it("年末調整で還付（プラス保存）なら、源泉徴収の合計から差し引く", () => {
      const r = computeAnnualAggregate(
        [salary(12, 300000, { incomeTax: -6000, customItemValues: { [YEAR_END_ADJUSTMENT]: 20000 } })],
        [],
        currentItems
      );
      assert.equal(r.incomeTaxWithheldTotal, 6000 - 20000);
    });

    it("賞与の「所得税(差額)」項目も同様に差し引く", () => {
      const r = computeAnnualAggregate(
        [],
        [bonus(2025, 6, 500000, { incomeTax: -15000, customItemValues: { [DIFF]: -1000 } })],
        currentItems
      );
      assert.equal(r.incomeTaxWithheldTotal, 15000 + 1000);
    });

    it("年末調整・所得税(差額)以外の項目は源泉徴収に影響しない", () => {
      const r = computeAnnualAggregate(
        [salary(1, 300000, { incomeTax: -6000, customItemValues: { [OTHER]: 10000 } })],
        [],
        currentItems
      );
      assert.equal(r.incomeTaxWithheldTotal, 6000);
    });
  });
});

describe("computeFurusatoNozeiIncomeProjection", () => {
  it("給与が1件も無ければ、見込みも0で全月が未登録", () => {
    const r = computeFurusatoNozeiIncomeProjection([], [], [], currentItems);
    assert.equal(r.estimatedGrossIncome, 0);
    assert.equal(r.estimatedSocialInsuranceTotal, 0);
    assert.equal(r.actualGrossIncome, 0);
    assert.deepEqual(r.registeredSalaryMonths, []);
    assert.deepEqual(r.missingSalaryMonths, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    assert.equal(r.projectedSalaryMonthCount, 0);
  });

  describe("給与の見込み", () => {
    const monthlyData = { baseGrossSalary: 300000, healthInsurance: -15000, pension: -27000, employmentInsurance: -1800 };

    it("6か月分あれば、同じ給与水準の残り6か月を平均で加算する", () => {
      const salaries = [1, 2, 3, 4, 5, 6].map((m) => salary(m, 300000, monthlyData));
      const r = computeFurusatoNozeiIncomeProjection(salaries, [], [], currentItems);
      assert.equal(r.actualGrossIncome, 1800000);
      assert.equal(r.estimatedGrossIncome, 3600000);
      assert.equal(r.actualSocialInsuranceTotal, 43800 * 6);
      assert.equal(r.estimatedSocialInsuranceTotal, 43800 * 12);
      assert.deepEqual(r.registeredSalaryMonths, [1, 2, 3, 4, 5, 6]);
      assert.deepEqual(r.missingSalaryMonths, [7, 8, 9, 10, 11, 12]);
      assert.equal(r.projectedSalaryMonthCount, 6);
    });

    it("12か月分そろっていれば、見込みを足さず実績のまま", () => {
      const salaries = Array.from({ length: 12 }, (_, i) => salary(i + 1, 300000, monthlyData));
      const r = computeFurusatoNozeiIncomeProjection(salaries, [], [], currentItems);
      assert.equal(r.estimatedGrossIncome, 3600000);
      assert.equal(r.projectedSalaryMonthCount, 0);
      assert.deepEqual(r.missingSalaryMonths, []);
    });

    it("昇給があれば、昇給後の月だけの平均で残り月を見込む", () => {
      // 1〜3月: 基本給25万円、4〜6月: 基本給30万円 → 残り6か月は30万円で見込む
      const salaries = [
        ...[1, 2, 3].map((m) => salary(m, 250000, { baseGrossSalary: 250000 })),
        ...[4, 5, 6].map((m) => salary(m, 300000, { baseGrossSalary: 300000 })),
      ];
      const r = computeFurusatoNozeiIncomeProjection(salaries, [], [], currentItems);
      assert.equal(r.actualGrossIncome, 750000 + 900000);
      assert.equal(r.estimatedGrossIncome, 750000 + 900000 + 300000 * 6);
    });

    it("同じ基本給の月の中に残業代などで支給額が違う月があれば、その平均で見込む", () => {
      const salaries = [
        salary(1, 300000, { baseGrossSalary: 300000 }),
        salary(2, 320000, { baseGrossSalary: 300000 }),
      ];
      const r = computeFurusatoNozeiIncomeProjection(salaries, [], [], currentItems);
      // 平均31万円 × 残り10か月
      assert.equal(r.estimatedGrossIncome, 620000 + 3100000);
    });

    it("非課税の通勤手当は、実績・平均のどちらからも除く", () => {
      const data = { baseGrossSalary: 300000, customItemValues: { [COMMUTE]: 10000 } };
      const salaries = [1, 2, 3, 4, 5, 6].map((m) => salary(m, 300000, data));
      const r = computeFurusatoNozeiIncomeProjection(salaries, [], [], currentItems);
      assert.equal(r.actualGrossIncome, 290000 * 6);
      assert.equal(r.estimatedGrossIncome, 290000 * 12);
    });

    it("支給日の月で登録月を数える（同じ月に2件あっても1か月）", () => {
      const salaries = [salary(1, 300000, monthlyData, 10), salary(1, 100000, monthlyData, 25)];
      const r = computeFurusatoNozeiIncomeProjection(salaries, [], [], currentItems);
      assert.deepEqual(r.registeredSalaryMonths, [1]);
      // 件数は2件なので残りは10か月
      assert.equal(r.projectedSalaryMonthCount, 10);
    });

    it("見込みの端数は四捨五入する", () => {
      // 平均 100,000.333… × 残り9か月 + 実績300,001 = 1,200,004
      const data = { baseGrossSalary: 100000 };
      const salaries = [salary(1, 100000, data), salary(2, 100000, data), salary(3, 100001, data)];
      const r = computeFurusatoNozeiIncomeProjection(salaries, [], [], currentItems);
      assert.equal(r.estimatedGrossIncome, 1200004);
      assert.equal(r.actualGrossIncome, 300001);
    });
  });

  describe("賞与の見込み", () => {
    it("前年に支給があった月のうち、今年まだ登録が無い月を前年同月の額で見込む", () => {
      // 前年: 6月・12月に支給。今年は6月分だけ登録済み → 12月分を前年実績で見込む
      const r = computeFurusatoNozeiIncomeProjection(
        [],
        [bonus(2025, 6, 520000)],
        [bonus(2024, 6, 500000), bonus(2024, 12, 600000)],
        currentItems
      );
      assert.deepEqual(r.registeredBonusMonths, [6]);
      assert.deepEqual(r.projectedBonusMonths, [12]);
      assert.equal(r.projectedBonusTotal, 600000);
      assert.equal(r.actualGrossIncome, 520000);
      assert.equal(r.estimatedGrossIncome, 520000 + 600000);
    });

    it("賞与の社会保険料も、実績と見込みの両方に含める", () => {
      const r = computeFurusatoNozeiIncomeProjection(
        [],
        [bonus(2025, 6, 520000, { healthInsurance: -26000 })],
        [bonus(2024, 12, 600000, { healthInsurance: -30000, pension: -55000 })],
        currentItems
      );
      assert.equal(r.actualSocialInsuranceTotal, 26000);
      assert.equal(r.estimatedSocialInsuranceTotal, 26000 + 85000);
    });

    it("前年の賞与に含まれる非課税項目は、見込み額からも除く", () => {
      const r = computeFurusatoNozeiIncomeProjection(
        [],
        [],
        [bonus(2024, 12, 600000, { customItemValues: { [COMMUTE]: 30000 } })],
        currentItems
      );
      assert.equal(r.projectedBonusTotal, 570000);
      assert.equal(r.estimatedGrossIncome, 570000);
    });

    it("今年すべての月が登録済みなら、前年の賞与は見込まない", () => {
      const r = computeFurusatoNozeiIncomeProjection(
        [],
        [bonus(2025, 6, 520000), bonus(2025, 12, 610000)],
        [bonus(2024, 6, 500000), bonus(2024, 12, 600000)],
        currentItems
      );
      assert.deepEqual(r.projectedBonusMonths, []);
      assert.equal(r.projectedBonusTotal, 0);
      assert.deepEqual(r.registeredBonusMonths, [6, 12]);
      assert.equal(r.estimatedGrossIncome, 1130000);
    });

    it("前年の賞与が無ければ、今年の登録分だけ", () => {
      const r = computeFurusatoNozeiIncomeProjection([], [bonus(2025, 6, 520000)], [], currentItems);
      assert.equal(r.estimatedGrossIncome, 520000);
      assert.deepEqual(r.projectedBonusMonths, []);
    });
  });

  it("給与と賞与の見込みを合算する", () => {
    const data = { baseGrossSalary: 300000, healthInsurance: -15000 };
    const salaries = [1, 2, 3, 4, 5, 6].map((m) => salary(m, 300000, data));
    const r = computeFurusatoNozeiIncomeProjection(
      salaries,
      [bonus(2025, 6, 500000)],
      [bonus(2024, 6, 480000), bonus(2024, 12, 600000)],
      currentItems
    );
    // 給与 30万×12 + 賞与 実績50万 + 12月の見込み60万
    assert.equal(r.estimatedGrossIncome, 3600000 + 500000 + 600000);
    assert.equal(r.actualGrossIncome, 1800000 + 500000);
    assert.equal(r.estimatedSocialInsuranceTotal, 15000 * 12);
  });
});
