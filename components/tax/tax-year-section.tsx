"use client";

import { useState } from "react";

import type { TaxYearData } from "@/lib/tax/data";
import type { DeductionType } from "@/lib/tax/types";
import { TaxCalculationDetail } from "./tax-calculation-detail";
import { FurusatoQuotaCard } from "./furusato-quota-card";
import { ChatGptSnapshotDialog } from "./chatgpt-snapshot-dialog";

export function TaxYearSection({ data }: { data: TaxYearData }) {
  const { year, overrides, isLocked, aggregate, projection, donationSummary } = data;
  const [liveAmounts, setLiveAmounts] = useState<Partial<Record<DeductionType, number>>>(data.amounts);

  // 源泉徴収票の値で上書き済みならそちらを、まだなら実績＋見込みの推定値を初期値にする。
  // 残り枠カードの試算欄と相談用スナップショットの両方が同じ試算値を参照するため、
  // 試算の状態はこのコンポーネントで一元管理する
  const baseGrossIncome = overrides.annualGrossIncome ?? projection.estimatedGrossIncome;
  const baseSocialInsuranceTotal =
    overrides.socialInsuranceTotal ?? projection.estimatedSocialInsuranceTotal;

  const [estimatedGrossIncome, setEstimatedGrossIncome] = useState<number | undefined>(
    baseGrossIncome || undefined
  );
  const [estimatedSocialInsuranceTotal, setEstimatedSocialInsuranceTotal] = useState<
    number | undefined
  >(baseSocialInsuranceTotal || undefined);

  // 源泉徴収票の値を保存した直後など、サーバー側の初期値が変わったら試算欄も追従させる
  // （props の変化に合わせて state を作り直すため、レンダー中に直接更新する）
  const [baseValues, setBaseValues] = useState({ baseGrossIncome, baseSocialInsuranceTotal });
  if (
    baseValues.baseGrossIncome !== baseGrossIncome ||
    baseValues.baseSocialInsuranceTotal !== baseSocialInsuranceTotal
  ) {
    setBaseValues({ baseGrossIncome, baseSocialInsuranceTotal });
    setEstimatedGrossIncome(baseGrossIncome || undefined);
    setEstimatedSocialInsuranceTotal(baseSocialInsuranceTotal || undefined);
  }

  // 残り枠カードの「源泉徴収票の値を入力して確定する」から、計算過程の「給与」の入力欄へ送る
  function goToWithholdingInput() {
    const input = document.getElementById(`annualGrossIncome-${year}`);
    if (!(input instanceof HTMLInputElement)) return;
    input.scrollIntoView({ behavior: "smooth", block: "center" });
    input.focus({ preventScroll: true });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-start">
      <div className="min-w-0 space-y-6">
        <FurusatoQuotaCard
          year={year}
          projection={projection}
          donationSummary={donationSummary}
          amounts={liveAmounts}
          overrides={overrides}
          grossIncome={estimatedGrossIncome}
          socialInsuranceTotal={estimatedSocialInsuranceTotal}
          onGrossIncomeChange={setEstimatedGrossIncome}
          onSocialInsuranceTotalChange={setEstimatedSocialInsuranceTotal}
          onGoToWithholdingInput={goToWithholdingInput}
        />
        <ChatGptSnapshotDialog
          state={{
            year,
            isLocked,
            aggregate,
            projection,
            amounts: liveAmounts,
            overrides,
            donation: donationSummary,
            estimatedGrossIncome,
            estimatedSocialInsuranceTotal,
          }}
        />
      </div>

      <div className="min-w-0">
        <p className="mb-2 text-sm font-medium">所得税・住民税 計算方法の詳細</p>
        {/* 保存後にサーバー側の値が変わったら入力欄の状態も作り直す（古い入力で上書きを消さないため） */}
        <TaxCalculationDetail
          key={JSON.stringify([overrides, data.amounts])}
          year={year}
          amounts={data.amounts}
          overrides={overrides}
          isLocked={isLocked}
          grossIncome={aggregate.grossIncome}
          socialInsuranceTotal={aggregate.socialInsuranceTotal}
          incomeTaxWithheldTotal={aggregate.incomeTaxWithheldTotal}
          donationSummary={donationSummary}
          onAmountsChange={setLiveAmounts}
        />
      </div>
    </div>
  );
}
