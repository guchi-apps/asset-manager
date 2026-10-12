// 税計算（annualTax.ts）の単体テスト。
//
// 期待値は、コードの出力を写したものではなく、国税庁・総務省の公表している速算表・控除額表を
// 手計算した値（またはその途中経過）。税制改正で閾値を直したときは、ここの表も条文に合わせて直す。
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  calculateAnnualEmploymentIncome,
  calculateAnnualResidentTax,
  calculateBasicDeductionForIncomeTax,
  calculateBasicDeductionForResidentTax,
  calculateIncomeTaxAmount,
  calculateIncomeTaxRate,
  getResidentTaxAssessmentYear,
  type ResidentTaxBreakdownField,
} from "./annual-tax";

type Case<T> = { name: string; input: T; expected: number };

function runTable(cases: Case<number>[], fn: (input: number) => number) {
  for (const { name, input, expected } of cases) {
    it(`${name}: ${input.toLocaleString("en-US")} → ${expected.toLocaleString("en-US")}`, () => {
      assert.equal(fn(input), expected);
    });
  }
}

// 条文は各区分の上限ちょうどを下の区分に含める（「以下」）。上限ちょうどの値を関数ごとに1件へまとめて比較する
// （失敗時のスタックトレースが大量に出ないようにするため）。
function boundaryTest(fn: (input: number) => number, boundaries: [number, number][]) {
  it("区間の上限ちょうど（条文どおり「以下」）", () => {
    assert.deepEqual(
      boundaries.map(([input]) => [input, fn(input)]),
      boundaries
    );
  });
}

describe("getResidentTaxAssessmentYear（住民税の課税年度＝所得の年）", () => {
  // 住民税は6月〜翌年5月に、前年の所得へ課税される。5月までの支給日は前々年の所得の年度に属する。
  const cases: [string, Date, number][] = [
    ["1月", new Date(2025, 0, 1), 2023],
    ["5月末日は前々年", new Date(2025, 4, 31), 2023],
    ["6月1日から前年", new Date(2025, 5, 1), 2024],
    ["12月末日", new Date(2025, 11, 31), 2024],
  ];
  for (const [name, date, expected] of cases) {
    it(`${name} → ${expected}`, () => {
      assert.equal(getResidentTaxAssessmentYear(date), expected);
    });
  }
});

describe("calculateAnnualEmploymentIncome（給与所得 = 給与収入 − 給与所得控除、令和7年分）", () => {
  runTable(
    [
      { name: "収入0円", input: 0, expected: -650000 },
      { name: "最低保障65万円の範囲", input: 1000000, expected: 350000 },
      { name: "190万円未満の最大", input: 1899999, expected: 1249999 },
      // 各区分の境界は両側の式が同じ値になるよう連続しているため、「未満/以下」の違いは結果に出ない
      { name: "190万円ちょうど", input: 1900000, expected: 1250000 },
      { name: "4,000円単位に切り捨て（区分内）", input: 1903999, expected: 1250000 },
      { name: "4,000円単位の次の区切り", input: 1904000, expected: 1252800 },
      { name: "360万円未満の最大（4,000円未満切り捨て）", input: 3599999, expected: 2437200 },
      { name: "360万円ちょうど", input: 3600000, expected: 2440000 },
      { name: "国税庁の例: 給与収入500万円", input: 5000000, expected: 3560000 },
      { name: "660万円未満の最大（4,000円未満切り捨て）", input: 6599999, expected: 4836800 },
      { name: "660万円ちょうど", input: 6600000, expected: 4840000 },
      { name: "850万円未満の最大（4,000円未満切り捨て）", input: 8499999, expected: 6546400 },
      { name: "850万円ちょうど", input: 8500000, expected: 6550000 },
      { name: "850万円超は控除額195万円で頭打ち", input: 10000000, expected: 8050000 },
    ],
    calculateAnnualEmploymentIncome
  );

  it("区分の境目で給与所得が減らない（収入が増えれば給与所得も増える）", () => {
    for (const boundary of [1900000, 3600000, 6600000, 8500000]) {
      assert.ok(
        calculateAnnualEmploymentIncome(boundary) >= calculateAnnualEmploymentIncome(boundary - 1),
        `${boundary} 円の前後で逆転している`
      );
    }
  });
});

describe("calculateBasicDeductionForIncomeTax（基礎控除・所得税、令和7年分）", () => {
  runTable(
    [
      { name: "132万円未満", input: 1319999, expected: 950000 },
      { name: "132万円超336万円未満", input: 1320001, expected: 880000 },
      { name: "336万円未満", input: 3359999, expected: 880000 },
      { name: "336万円超489万円未満", input: 3360001, expected: 680000 },
      { name: "489万円未満", input: 4889999, expected: 680000 },
      { name: "489万円超655万円未満", input: 4890001, expected: 630000 },
      { name: "655万円未満", input: 6549999, expected: 630000 },
      { name: "655万円超2,350万円未満", input: 6550001, expected: 580000 },
      { name: "2,350万円未満", input: 23499999, expected: 580000 },
      { name: "2,350万円超2,400万円未満", input: 23500001, expected: 480000 },
      { name: "2,400万円未満", input: 23999999, expected: 480000 },
      { name: "2,400万円超2,450万円未満", input: 24000001, expected: 320000 },
      { name: "2,450万円未満", input: 24499999, expected: 320000 },
      { name: "2,450万円超2,500万円未満", input: 24500001, expected: 160000 },
      { name: "2,500万円未満", input: 24999999, expected: 160000 },
      { name: "2,500万円超は0円", input: 25000001, expected: 0 },
    ],
    calculateBasicDeductionForIncomeTax
  );

  // 条文は「合計所得金額が132万円以下」など、各区分の上限ちょうどを下の区分に含める。
  boundaryTest(calculateBasicDeductionForIncomeTax, [
    [1320000, 950000],
    [3360000, 880000],
    [4890000, 680000],
    [6550000, 630000],
    [23500000, 580000],
    [24000000, 480000],
    [24500000, 320000],
    [25000000, 160000],
  ]);
});

describe("calculateBasicDeductionForResidentTax（基礎控除・住民税）", () => {
  runTable(
    [
      { name: "2,400万円未満", input: 23999999, expected: 430000 },
      { name: "低所得でも43万円", input: 0, expected: 430000 },
      { name: "2,400万円超2,450万円未満", input: 24000001, expected: 290000 },
      { name: "2,450万円未満", input: 24499999, expected: 290000 },
      { name: "2,450万円超2,500万円未満", input: 24500001, expected: 150000 },
      { name: "2,500万円未満", input: 24999999, expected: 150000 },
      { name: "2,500万円超は0円", input: 25000001, expected: 0 },
    ],
    calculateBasicDeductionForResidentTax
  );

  boundaryTest(calculateBasicDeductionForResidentTax, [
    [24000000, 430000],
    [24500000, 290000],
    [25000000, 150000],
  ]);
});

describe("calculateIncomeTaxRate（所得税の税率区分＝限界税率）", () => {
  runTable(
    [
      { name: "0円", input: 0, expected: 0.05 },
      { name: "195万円未満", input: 1949000, expected: 0.05 },
      { name: "195万円超330万円未満", input: 1951000, expected: 0.1 },
      { name: "330万円未満", input: 3299000, expected: 0.1 },
      { name: "330万円超695万円未満", input: 3301000, expected: 0.2 },
      { name: "695万円未満", input: 6949000, expected: 0.2 },
      { name: "695万円超900万円未満", input: 6951000, expected: 0.23 },
      { name: "900万円未満", input: 8999000, expected: 0.23 },
      { name: "900万円超1,800万円未満", input: 9001000, expected: 0.33 },
      { name: "1,800万円未満", input: 17999000, expected: 0.33 },
      { name: "1,800万円超4,000万円未満", input: 18001000, expected: 0.4 },
      { name: "4,000万円未満", input: 39999000, expected: 0.4 },
      { name: "4,000万円超", input: 40001000, expected: 0.45 },
    ],
    calculateIncomeTaxRate
  );

  // 課税所得金額は1,000円未満切り捨て済みで、195万円ちょうどなどはそのまま入力になりうる。
  // 税額（calculateIncomeTaxAmount）が「超」で加算しているのと同じ区分に、税率も合わせる。
  boundaryTest(calculateIncomeTaxRate, [
    [1950000, 0.05],
    [3300000, 0.1],
    [6950000, 0.2],
    [9000000, 0.23],
    [18000000, 0.33],
    [40000000, 0.4],
  ]);
});

describe("calculateIncomeTaxAmount（所得税額、国税庁の速算表）", () => {
  // 速算表: 税額 = 課税所得 × 税率 − 控除額
  //  〜195万円 5% −0 / 〜330万円 10% −9.75万円 / 〜695万円 20% −42.75万円 / 〜900万円 23% −63.6万円
  //  〜1,800万円 33% −153.6万円 / 〜4,000万円 40% −279.6万円 / 4,000万円超 45% −479.6万円
  runTable(
    [
      { name: "0円", input: 0, expected: 0 },
      { name: "5%の範囲", input: 1000000, expected: 50000 },
      { name: "195万円ちょうど", input: 1950000, expected: 97500 },
      { name: "10%の範囲", input: 3000000, expected: 202500 },
      { name: "330万円ちょうど", input: 3300000, expected: 232500 },
      { name: "20%の範囲", input: 5000000, expected: 572500 },
      { name: "695万円ちょうど", input: 6950000, expected: 962500 },
      { name: "23%の範囲", input: 8000000, expected: 1204000 },
      { name: "900万円ちょうど", input: 9000000, expected: 1434000 },
      { name: "33%の範囲", input: 15000000, expected: 3414000 },
      { name: "1,800万円ちょうど", input: 18000000, expected: 4404000 },
      { name: "40%の範囲", input: 30000000, expected: 9204000 },
      { name: "4,000万円ちょうど", input: 40000000, expected: 13204000 },
      { name: "45%の範囲", input: 50000000, expected: 17704000 },
    ],
    calculateIncomeTaxAmount
  );

  it("区分の境目で税額が減らない", () => {
    for (const boundary of [1950000, 3300000, 6950000, 9000000, 18000000, 40000000]) {
      assert.ok(
        calculateIncomeTaxAmount(boundary + 1000) > calculateIncomeTaxAmount(boundary),
        `${boundary} 円の前後で税額が増えていない`
      );
    }
  });
});

describe("calculateAnnualResidentTax", () => {
  const baseInput = {
    annualGrossIncome: 5000000,
    socialInsuranceTotal: 750000,
    lifeInsuranceGeneral: 0,
    lifeInsuranceCareMedical: 0,
    lifeInsurancePension: 0,
    furusatoNozei: 0,
    incomeTaxWithheldTotal: 100000,
  };

  // 独身・扶養なし、給与収入500万円・社会保険料75万円・ふるさと納税なし。
  //  給与所得 500万×80%−44万 = 356万 / 所得税の基礎控除 68万 → 課税所得 356万−(75万+68万) = 213万
  //  所得税 213万×10%−9.75万 = 115,500 / 復興特別所得税 floor(115,500×2.1%) = 2,425
  //  住民税の課税所得 356万−(75万+43万) = 238万 / 所得割 市6% 142,800・県4% 95,200
  //  調整控除 市1,500・県1,000 / 均等割 市3,000・県1,000・森林環境税1,000
  describe("ふるさと納税なし（給与収入500万円）", () => {
    const r = calculateAnnualResidentTax(baseInput);

    const expected: Partial<Record<ResidentTaxBreakdownField, number>> = {
      employmentIncome: 3560000,
      basicDeductionForIncomeTax: 680000,
      incomeDeductionTotalForIncomeTax: 1430000,
      taxableIncomeForIncomeTax: 2130000,
      incomeTaxRate: 0.1,
      incomeTaxAmount: 115500,
      reconstructionSurtax: 2425,
      incomeTaxAndSurtaxTotal: 117925,
      taxReturnPayment: 17925,
      basicDeductionForResidentTax: 430000,
      incomeDeductionTotalForResidentTax: 1180000,
      taxableIncomeForResidentTax: 2380000,
      incomeLeviedCity: 142800,
      incomeLeviedPrefecture: 95200,
      totalIncomeLevied: 238000,
      adjustmentDeductionTotal: 2500,
      incomeLeviedAfterAdjustment: 235500,
      incomeLeviedAfterAdjustmentTimes02: 47100,
      // 47,100 ÷ (1 − 10% − 10%×1.021) + 2,000 = 61,029.95… → 四捨五入
      furusatoNozeiLimit: 61030,
      donationBase: 0,
      donationCreditCity: 0,
      donationCreditPrefecture: 0,
      incomeLeviedCityFinal: 141300,
      incomeLeviedPrefectureFinal: 94200,
      annualTotal: 240500,
      // 240,500 ÷ 12 = 20,041.6… → 100円未満切り捨てで20,000円×11か月、残りを6月に寄せる
      elevenMonthAmount: 20000,
      juneAmount: 20500,
    };
    for (const [field, value] of Object.entries(expected)) {
      it(`${field} = ${value}`, () => {
        assert.equal(r[field as ResidentTaxBreakdownField].value, value);
      });
    }

    it("上書きしていなければ auto と value が一致する", () => {
      for (const [field, v] of Object.entries(r)) {
        assert.equal(v.value, v.auto, `${field} の value と auto が異なる`);
      }
    });
  });

  // ふるさと納税3万円: 控除の対象は自己負担2,000円を除いた28,000円。
  //  所得税の課税所得 356万−(75万+68万+2.8万) = 210.2万 → 所得税 112,700・復興 2,366
  //  住民税の寄附金税額控除 基本分10% 2,800 + 特例分 28,000×(1−10%−10%×1.021) = 22,341.2
  //  → 合計25,141.2を市6:県4で按分し切り上げ 市15,085・県10,057
  describe("ふるさと納税3万円（給与収入500万円）", () => {
    const r = calculateAnnualResidentTax({ ...baseInput, furusatoNozei: 30000 });

    it("所得税側: 寄附金控除で課税所得が2.8万円下がる", () => {
      assert.equal(r.furusatoDeductionForIncomeTax.value, 28000);
      assert.equal(r.taxableIncomeForIncomeTax.value, 2102000);
      assert.equal(r.incomeTaxAmount.value, 112700);
      assert.equal(r.reconstructionSurtax.value, 2366);
      assert.equal(r.taxReturnPayment.value, 15066);
    });

    it("住民税側: 寄附金税額控除を市6:県4で按分して所得割から引く", () => {
      assert.equal(r.donationBase.value, 28000);
      assert.equal(r.donationCreditBasic.value, 2800);
      assert.ok(Math.abs(r.donationCreditSpecial.value - 22341.2) < 1e-6);
      assert.equal(r.donationCreditCity.value, 15085);
      assert.equal(r.donationCreditPrefecture.value, 10057);
      assert.equal(r.incomeLeviedCityFinal.value, 126200);
      assert.equal(r.incomeLeviedPrefectureFinal.value, 84100);
      assert.equal(r.annualTotal.value, 215300);
    });

    it("上限額は寄付額に依存しない", () => {
      assert.equal(r.furusatoNozeiLimit.value, 61030);
    });
  });

  it("ふるさと納税が自己負担額2,000円以下なら控除額は0円", () => {
    const r = calculateAnnualResidentTax({ ...baseInput, furusatoNozei: 2000 });
    assert.equal(r.furusatoDeductionForIncomeTax.value, 0);
    assert.equal(r.donationBase.value, 0);
    assert.equal(r.annualTotal.value, 240500);
  });

  it("寄付が特例分の上限（所得割額の2割）を超えると、特例分は上限で頭打ちになる", () => {
    // 上限額61,030円の10倍を寄付しても、特例分控除は所得割額(調整控除後)×20% = 47,100円まで
    const r = calculateAnnualResidentTax({ ...baseInput, furusatoNozei: 610300 });
    assert.equal(r.donationCreditSpecial.value, 47100);
  });

  it("所得割が控除しきれないときは0円で止まり、均等割・森林環境税だけ残る", () => {
    // 課税所得 1,000円未満（給与収入70万円 → 給与所得5万円 − 社会保険料0 − 基礎控除43万円 ≦ 0）
    const r = calculateAnnualResidentTax({
      ...baseInput,
      annualGrossIncome: 700000,
      socialInsuranceTotal: 0,
      incomeTaxWithheldTotal: 0,
    });
    assert.equal(r.taxableIncomeForResidentTax.value, 0);
    assert.equal(r.incomeLeviedCityFinal.value, 0);
    assert.equal(r.incomeLeviedPrefectureFinal.value, 0);
    assert.equal(r.annualTotal.value, 5000);
    assert.equal(r.taxableIncomeForIncomeTax.value, 0);
    assert.equal(r.incomeTaxAmount.value, 0);
  });

  describe("生命保険料控除（各種別ごと。3種合計の上限は課さない）", () => {
    // 所得税: 〜2万円 全額 / 〜4万円 1/2+1万円 / 〜8万円 1/4+2万円 / 8万円超 4万円
    // 住民税: 〜1.2万円 全額 / 〜3.2万円 1/2+0.6万円 / 〜5.6万円 1/4+1.4万円 / 5.6万円超 2.8万円
    const cases: [number, number, number][] = [
      // [支払保険料, 所得税の控除額, 住民税の控除額]
      [0, 0, 0],
      [10000, 10000, 10000],
      [12000, 12000, 12000],
      [20000, 20000, 16000],
      [30000, 25000, 21000],
      [32000, 26000, 22000],
      [40000, 30000, 24000],
      [56000, 34000, 28000],
      [60000, 35000, 28000],
      [80000, 40000, 28000],
      [100000, 40000, 28000],
    ];
    for (const [premium, incomeTax, residentTax] of cases) {
      it(`保険料 ${premium.toLocaleString("en-US")} 円 → 所得税 ${incomeTax.toLocaleString("en-US")} / 住民税 ${residentTax.toLocaleString("en-US")}`, () => {
        const r = calculateAnnualResidentTax({ ...baseInput, lifeInsuranceGeneral: premium });
        assert.equal(r.lifeInsuranceGeneralDeductionIncomeTax.value, incomeTax);
        assert.equal(r.lifeInsuranceGeneralDeductionResidentTax.value, residentTax);
      });
    }

    it("一般・介護医療・個人年金の3種を合算して所得控除に入れる", () => {
      const r = calculateAnnualResidentTax({
        ...baseInput,
        lifeInsuranceGeneral: 30000,
        lifeInsuranceCareMedical: 60000,
        lifeInsurancePension: 100000,
      });
      assert.equal(r.lifeInsuranceForIncomeTax.value, 25000 + 35000 + 40000);
      assert.equal(r.lifeInsuranceForResidentTax.value, 21000 + 28000 + 28000);
    });
  });

  describe("overrides（実際の申告書・通知書の金額での上書き）", () => {
    it("上書きした値が value になり、auto には計算値が残る", () => {
      const r = calculateAnnualResidentTax(baseInput, { employmentIncome: 3000000 });
      assert.equal(r.employmentIncome.value, 3000000);
      assert.equal(r.employmentIncome.auto, 3560000);
    });

    it("上書きした値は下流のステップに反映される", () => {
      // 給与所得を300万円に上書き → 基礎控除88万円・課税所得 300万−(75万+88万) = 137万
      const r = calculateAnnualResidentTax(baseInput, { employmentIncome: 3000000 });
      assert.equal(r.basicDeductionForIncomeTax.value, 880000);
      assert.equal(r.taxableIncomeForIncomeTax.value, 1370000);
      assert.equal(r.incomeTaxAmount.value, 68500);
    });

    it("0円での上書きも有効（未指定とは区別される）", () => {
      const r = calculateAnnualResidentTax(baseInput, { incomeTaxWithheldTotal: 0 });
      assert.equal(r.incomeTaxWithheldTotal.value, 0);
      assert.equal(r.taxReturnPayment.value, 117925);
    });

    it("NaN の上書きは無視して計算値を使う", () => {
      const r = calculateAnnualResidentTax(baseInput, { employmentIncome: Number.NaN });
      assert.equal(r.employmentIncome.value, 3560000);
    });

    it("令和6年分の定額減税は既定0円で、上書きすると税額から引かれる", () => {
      assert.equal(calculateAnnualResidentTax(baseInput).flatTaxReduction2024.value, 0);
      const r = calculateAnnualResidentTax(baseInput, { flatTaxReduction2024: 30000 });
      // (115,500 − 30,000) = 85,500 → 復興 floor(85,500×2.1%) = 1,795
      assert.equal(r.baseIncomeTaxAmount.value, 85500);
      assert.equal(r.reconstructionSurtax.value, 1795);
      assert.equal(r.incomeTaxAndSurtaxTotal.value, 87295);
    });
  });
});
