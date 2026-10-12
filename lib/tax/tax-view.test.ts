// 残り枠（quota.ts）と相談用スナップショット（view.ts・snapshot.ts）の整合、寄付の二重計上、入力検証の単体テスト。
// 画面（残り枠カード）とスナップショットが同じ値を指すこと、寄付明細のみ／調整額併用／未登録月あり／
// 源泉徴収票入力済みの4ケースで推定状態まで一致することを固定する。
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AnnualAggregate, FurusatoNozeiIncomeProjection } from "./aggregate";
import { EMPTY_DONATION_DETAIL, withAdjustment, type DonationDetailSummary } from "./donation";
import { computeQuota } from "./quota";
import { buildSnapshotText } from "./snapshot";
import { buildSnapshotFromState, type TaxViewState } from "./view";
import { LockYearSchema, SaveDeductionsSchema, SaveOverridesSchema } from "./validators";
import { RESIDENT_TAX_BREAKDOWN_FIELDS } from "./annual-tax";
import { summarizeDonations } from "../furusato/summary";

const aggregate: AnnualAggregate = {
  grossIncome: 4_800_000,
  socialInsuranceTotal: 700_000,
  incomeTaxWithheldTotal: 110_000,
  salaryCount: 9,
  bonusCount: 1,
};

const projectionWithGaps: FurusatoNozeiIncomeProjection = {
  estimatedGrossIncome: 6_000_000,
  estimatedSocialInsuranceTotal: 880_000,
  actualGrossIncome: 4_800_000,
  actualSocialInsuranceTotal: 700_000,
  registeredSalaryMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  missingSalaryMonths: [10, 11, 12],
  projectedSalaryMonthCount: 3,
  registeredBonusMonths: [6],
  projectedBonusMonths: [12],
  projectedBonusTotal: 400_000,
};

const completeProjection: FurusatoNozeiIncomeProjection = {
  ...projectionWithGaps,
  estimatedGrossIncome: 4_800_000,
  estimatedSocialInsuranceTotal: 700_000,
  registeredSalaryMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  missingSalaryMonths: [],
  projectedSalaryMonthCount: 0,
  projectedBonusMonths: [],
  projectedBonusTotal: 0,
};

const donationDetail: DonationDetailSummary = {
  total: 60_000,
  donationCount: 2,
  lastDonationDate: "2026-09-01T00:00:00.000Z",
  municipalityCount: 2,
  oneStopPendingCount: 1,
  certificatePendingCount: 1,
  items: [
    { donatedAt: "2026-05-10", amount: 20_000, oneStopStatus: "applied", certificateStatus: "received" },
    { donatedAt: "2026-09-01", amount: 40_000, oneStopStatus: "notApplied", certificateStatus: "notReceived" },
  ],
};

function state(overrides: Partial<TaxViewState>): TaxViewState {
  return {
    year: 2026,
    isLocked: false,
    aggregate,
    projection: projectionWithGaps,
    amounts: {},
    overrides: {},
    donation: withAdjustment(donationDetail, 0),
    estimatedGrossIncome: projectionWithGaps.estimatedGrossIncome,
    estimatedSocialInsuranceTotal: projectionWithGaps.estimatedSocialInsuranceTotal,
    ...overrides,
  };
}

function quotaOf(s: TaxViewState) {
  return computeQuota({
    projection: s.projection,
    amounts: s.amounts,
    overrides: s.overrides,
    donation: s.donation,
    grossIncome: s.estimatedGrossIncome,
    socialInsuranceTotal: s.estimatedSocialInsuranceTotal,
  });
}

const CASES: { name: string; s: TaxViewState; limitState: string }[] = [
  { name: "寄付明細のみ（未登録月あり）", s: state({}), limitState: "estimate" },
  {
    name: "調整額を併用",
    s: state({ amounts: { furusatoNozei: 12_000 }, donation: withAdjustment(donationDetail, 12_000) }),
    limitState: "estimate",
  },
  {
    name: "寄付明細なし・調整額のみ（移行前の形）",
    s: state({
      amounts: { furusatoNozei: 30_000 },
      donation: withAdjustment(EMPTY_DONATION_DETAIL, 30_000),
      projection: completeProjection,
      estimatedGrossIncome: 4_800_000,
      estimatedSocialInsuranceTotal: 700_000,
    }),
    limitState: "estimate",
  },
  {
    name: "源泉徴収票の値で入力済み",
    s: state({
      isLocked: true,
      projection: completeProjection,
      overrides: { annualGrossIncome: 4_980_000, socialInsuranceTotal: 738_120, incomeTaxWithheldTotal: 118_000 },
      estimatedGrossIncome: 4_980_000,
      estimatedSocialInsuranceTotal: 738_120,
    }),
    limitState: "confirmed",
  },
];

describe("残り枠とスナップショットの一致", () => {
  for (const { name, s, limitState } of CASES) {
    it(`${name}: 上限額・寄付済額・残り枠・推定状態が同じ値になる`, () => {
      const quota = quotaOf(s);
      const snapshot = buildSnapshotFromState(s, new Date(2026, 9, 12, 9, 0), "7.14.0");
      const fn = snapshot.furusatoNozei;

      assert.equal(fn.limit, Math.round(quota.limit));
      assert.equal(fn.donated, Math.round(quota.donated));
      assert.equal(fn.remaining, Math.round(quota.remaining));
      assert.equal(fn.limitState, limitState);
      assert.equal(quota.status, limitState);
      assert.equal(fn.donatedDetailTotal, s.donation.total);
      assert.equal(fn.donations.length, s.donation.items.length);
      assert.equal(snapshot.meta.confirmed, s.isLocked);
    });
  }

  it("試算値を変えると、残り枠とスナップショットが同じ新しい値を参照する", () => {
    const base = state({});
    const changed = state({ estimatedGrossIncome: 7_500_000, estimatedSocialInsuranceTotal: 1_100_000 });
    const q0 = quotaOf(base);
    const q1 = quotaOf(changed);
    assert.ok(q1.limit > q0.limit);
    const snap = buildSnapshotFromState(changed, new Date(2026, 9, 12), "7.14.0");
    assert.equal(snap.furusatoNozei.limit, Math.round(q1.limit));
    assert.equal(snap.income.grossIncomeProjected, 7_500_000);
    assert.equal(snap.income.socialInsuranceProjected, 1_100_000);
    // 実績ベースの項目は試算値の影響を受けない
    assert.equal(snap.income.grossIncomeActual, aggregate.grossIncome);
  });
});

describe("寄付済額の二重計上", () => {
  it("寄付済額は 明細合計 + 調整額。明細を調整額へ書き写さない限り二重にならない", () => {
    const s = state({ amounts: { furusatoNozei: 12_000 }, donation: withAdjustment(donationDetail, 12_000) });
    assert.equal(quotaOf(s).donated, 72_000);
    assert.equal(s.donation.effectiveTotal, 72_000);
  });

  it("編集中の調整額（保存前）が残り枠に即座に反映される", () => {
    const saved = withAdjustment(donationDetail, 0);
    const q = computeQuota({
      projection: projectionWithGaps,
      amounts: { furusatoNozei: 5_000 },
      overrides: {},
      donation: saved,
      grossIncome: 6_000_000,
      socialInsuranceTotal: 880_000,
    });
    assert.equal(q.donated, 65_000);
    assert.equal(q.adjustment, 5_000);
  });

  it("寄付の正本（#715 の summarizeDonations）と同じ寄付済額になる", () => {
    const rows = donationDetail.items.map((item) => ({
      donatedAt: item.donatedAt,
      amount: item.amount,
      municipality: item.amount === 20_000 ? "A市" : "B町",
      oneStopStatus: item.oneStopStatus,
      certificateStatus: item.certificateStatus,
    }));
    for (const adjustment of [0, 12_000]) {
      const source = summarizeDonations(rows, adjustment);
      const mine = withAdjustment(donationDetail, adjustment);
      assert.equal(mine.effectiveTotal, source.effectiveTotal);
      assert.equal(mine.total, source.total);
      assert.equal(mine.oneStopPendingCount, source.oneStopPendingCount);
      assert.equal(mine.certificatePendingCount, source.certificatePendingCount);
    }
  });

  it("明細が無い年は source が deduction（調整額だけ）になる", () => {
    assert.equal(withAdjustment(EMPTY_DONATION_DETAIL, 30_000).source, "deduction");
    assert.equal(withAdjustment(donationDetail, 0).source, "donations");
  });
});

describe("スナップショットの内容", () => {
  it("寄付明細・申請/証明書の状況・計算前提を欠落させず、自治体名は含まない", () => {
    const snap = buildSnapshotFromState(state({}), new Date(2026, 9, 12), "7.14.0");
    const text = buildSnapshotText(snap, "todo", "markdown");
    assert.match(text, /### 寄付明細/);
    assert.match(text, /2026-05-10/);
    assert.match(text, /2026-09-01/);
    assert.match(text, /ワンストップ特例が未申請の寄付が1件/);
    assert.match(text, /寄附金受領証明書が未取得の寄付が1件/);
    assert.match(text, /扶養親族なし/);
    assert.match(text, /給与が3か月分未登録/);
    assert.match(text, /賞与12月分が未登録/);
    assert.match(text, /推定（見込みを含む）/);
    assert.equal(snap.furusatoNozei.donations.length, 2);
  });

  it("確定済みなら「確定していません」を出さず、推定ではなく確認済みと表示する", () => {
    const snap = buildSnapshotFromState(CASES[3].s, new Date(2026, 9, 12), "7.14.0");
    assert.equal(snap.unconfirmed.some((line) => line.includes("まだ確定していません")), false);
    assert.match(snap.meta.dataState, /確定済み/);
    assert.match(buildSnapshotText(snap, "limit", "markdown"), /確認済み（源泉徴収票の値）/);
  });

  it("寄付先が6自治体以上ならワンストップ特例が使えない旨を未確認項目に出す", () => {
    const many = { ...donationDetail, municipalityCount: 6 };
    const snap = buildSnapshotFromState(state({ donation: withAdjustment(many, 0) }), new Date(2026, 9, 12), "7.14.0");
    assert.equal(snap.furusatoNozei.oneStopEligible, false);
    assert.ok(snap.unconfirmed.some((line) => line.includes("6自治体")));
  });

  it("JSON 形式でも寄付明細が含まれる", () => {
    const snap = buildSnapshotFromState(state({}), new Date(2026, 9, 12), "7.14.0");
    assert.match(buildSnapshotText(snap, "limit", "json"), /"donatedAt": "2026-05-10"/);
  });
});

describe("保存入力の検証", () => {
  it("控除は0以上のみ。未知の種類・範囲外の年は拒否する", () => {
    assert.ok(SaveDeductionsSchema.safeParse({ year: 2026, amounts: { lifeInsuranceGeneral: 40_000 } }).success);
    assert.equal(SaveDeductionsSchema.safeParse({ year: 2026, amounts: { lifeInsuranceGeneral: -1 } }).success, false);
    assert.equal(SaveDeductionsSchema.safeParse({ year: 2026, amounts: { unknown: 1 } }).success, false);
    assert.equal(SaveDeductionsSchema.safeParse({ year: 1999, amounts: {} }).success, false);
    assert.equal(SaveDeductionsSchema.safeParse({ year: 2026, amounts: { furusatoNozei: 1e12 } }).success, false);
  });

  it("上書きは項目キーを限定し、null で解除できる", () => {
    assert.ok(SaveOverridesSchema.safeParse({ year: 2026, values: { annualGrossIncome: 5_000_000, taxReturnPayment: null } }).success);
    assert.equal(SaveOverridesSchema.safeParse({ year: 2026, values: { notAField: 1 } }).success, false);
    assert.equal(SaveOverridesSchema.safeParse({ year: 2026, values: { annualGrossIncome: Number.NaN } }).success, false);
  });

  it("確定は全項目の値が必要", () => {
    const all = Object.fromEntries(RESIDENT_TAX_BREAKDOWN_FIELDS.map((f) => [f, 1]));
    assert.ok(LockYearSchema.safeParse({ year: 2026, values: all }).success);
    const { annualGrossIncome: _omit, ...partial } = all;
    void _omit;
    assert.equal(LockYearSchema.safeParse({ year: 2026, values: partial }).success, false);
  });
});
