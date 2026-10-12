// ChatGPTへ相談するために、対象年の集計値・前提・未確認項目を1つのテキストにまとめる。
// 計算そのものは annualTax.ts が正で、ここは「すでに計算・記録された値を持ち出す」ことだけを行う。
//
// 出力してよいのは金額の集計値と件数のみ。個人番号・給与明細画像・口座情報・自治体名・
// 氏名やメールアドレスといった識別情報は、入力として受け取らないことで構造的に出力を防いでいる。

import type { DonationItem, DonationSummary } from "./donation";

export const SNAPSHOT_PURPOSES = [
  {
    key: "limit",
    label: "上限額の確認",
    description: "あと何円まで寄付できるかを相談する",
    prompt:
      "ふるさと納税の上限額の目安に対して、あと何円まで寄付してよさそうかを確認したいです。" +
      "上限額の考え方に見落としがないか、年内に寄付を増やす場合の注意点とあわせて教えてください。",
  },
  {
    key: "filing",
    label: "確定申告の要否",
    description: "申告が必要かどうかを相談する",
    prompt:
      "この内容で確定申告が必要かどうかを確認したいです。" +
      "必要な場合は用意する書類と提出時期、不要な場合はその理由を教えてください。",
  },
  {
    key: "todo",
    label: "未完了の手続き",
    description: "やり残している手続きを洗い出す",
    prompt:
      "ふるさと納税・年末調整・確定申告について、まだ終わっていない手続きと期限を洗い出したいです。" +
      "下の「未確認・未完了の項目」も踏まえて、いつまでに何をすればよいかを教えてください。",
  },
] as const;

export type SnapshotPurpose = (typeof SNAPSHOT_PURPOSES)[number]["key"];
export type SnapshotFormat = "markdown" | "json";

const PROMPT_PREAMBLE =
  "以下は日本の給与所得者1人分の税務データです。給与・資産管理アプリ「Asset Manager」が集計・試算した値で、" +
  "正式な計算と申告は e-Tax／国税庁のサイトで行います。数字を計算し直すのではなく、" +
  "前提の見落としや手続きの漏れがないかの確認をお願いします。";

export type TaxSnapshotInput = {
  year: number;
  generatedAt: Date;
  appVersion: string;
  /** その年の計算過程が「確定済み」として固定されているか */
  isLocked: boolean;
  /** 登録済みの給与・賞与だけを集計した実績値 */
  actual: {
    grossIncome: number;
    socialInsuranceTotal: number;
    incomeTaxWithheldTotal: number;
  };
  /** 未登録の残り月を見込んだ年収・社会保険料 */
  projected: {
    grossIncome: number;
    socialInsuranceTotal: number;
    /** 見込みで補った給与の月数 */
    salaryMonths: number;
    /** 前年同月の実績から見込んだ賞与の月（1〜12） */
    bonusMonths: number[];
  };
  registeredSalaryCount: number;
  registeredBonusCount: number;
  premiums: {
    lifeInsuranceGeneral: number;
    lifeInsuranceCareMedical: number;
    lifeInsurancePension: number;
  };
  furusato: {
    /** 見込み年収ベースの上限額の目安 */
    limit: number;
    /** 寄付済額。通常は寄付明細の合計 + 調整額（`donations.effectiveTotal`）。残り枠カードと同じ値を渡す */
    donated: number;
    /** 残り枠カードの状態。"confirmed" は源泉徴収票の値で確定確認済み、"estimate" は見込み、"over" は上限超過 */
    status: "over" | "confirmed" | "estimate";
  };
  /** 寄付明細・調整額（明細の内訳を載せるため） */
  donations: DonationSummary;
  /** 実績ベースで試算した所得税・住民税 */
  tax: {
    employmentIncome: number;
    incomeDeductionTotalForIncomeTax: number;
    taxableIncomeForIncomeTax: number;
    incomeTaxRate: number;
    incomeTaxAndSurtaxTotal: number;
    taxReturnPayment: number;
    residentTaxAnnualTotal: number;
  };
};

export type TaxSnapshot = {
  meta: {
    year: number;
    generatedAt: string;
    source: string;
    dataState: string;
    /** 源泉徴収票等の値で確定済みか。false は推定 */
    confirmed: boolean;
  };
  income: {
    grossIncomeActual: number;
    grossIncomeProjected: number;
    socialInsuranceActual: number;
    socialInsuranceProjected: number;
    incomeTaxWithheld: number;
    registeredSalaryCount: number;
    registeredBonusCount: number;
    includesProjection: boolean;
  };
  deductions: {
    lifeInsuranceGeneral: number;
    lifeInsuranceCareMedical: number;
    lifeInsurancePension: number;
  };
  furusatoNozei: {
    limit: number;
    /** 寄付済額。寄付明細の合計 + 調整額 */
    donated: number;
    /** 上限額の状態。"estimate" は推定（見込みを含む）、"confirmed" は源泉徴収票の値で確認済み */
    limitState: "over" | "confirmed" | "estimate";
    donatedDetailTotal: number;
    donatedAdjustment: number;
    remaining: number;
    donationCount: number;
    municipalityCount: number;
    oneStopPendingCount: number;
    certificatePendingCount: number;
    /** 寄付先が5自治体以内か。寄付明細が無ければ null */
    oneStopEligible: boolean | null;
    /** 寄付明細（自治体名は含めない） */
    donations: DonationItem[];
  };
  taxEstimate: {
    employmentIncome: number;
    incomeDeductionTotal: number;
    taxableIncome: number;
    incomeTaxRatePercent: number;
    incomeTaxAndSurtaxTotal: number;
    taxReturnPayment: number;
    residentTaxAnnualTotal: number;
  };
  assumptions: string[];
  unconfirmed: string[];
  cautions: string[];
};

const ONE_STOP_LABELS: Record<string, string> = {
  notApplied: "未申請",
  applied: "申請済み",
  accepted: "受付済み",
  switchedToTaxReturn: "確定申告へ切替",
};

const CERTIFICATE_LABELS: Record<string, string> = {
  notReceived: "未取得",
  received: "受領済み",
  notNeeded: "不要",
};

const LIMIT_STATE_LABELS = {
  estimate: "推定（見込みを含む）",
  confirmed: "確認済み（源泉徴収票の値）",
  over: "推定。寄付済額が上限額の目安を超えています",
} as const;

function yen(value: number): string {
  return `${Math.round(value).toLocaleString("ja-JP")} 円`;
}

function formatDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

const CAUTIONS = [
  "正式な上限額の計算・確定申告の提出は e-Tax／国税庁のサイトで行ってください。ここに書かれた金額は最終確認の代わりにはなりません。",
  "この出力には個人番号・給与明細画像・口座情報・自治体名は含まれていません。寄付明細は日付・金額・申請/証明書の状況だけです。",
];

export function buildTaxSnapshot(input: TaxSnapshotInput): TaxSnapshot {
  const {
    year,
    generatedAt,
    appVersion,
    isLocked,
    actual,
    projected,
    registeredSalaryCount,
    registeredBonusCount,
    premiums,
    furusato,
    donations,
    tax,
  } = input;

  const includesProjection = projected.salaryMonths > 0 || projected.bonusMonths.length > 0;
  const dataState = isLocked
    ? "確定済み（申告・課税決定通知書の金額で固定）"
    : includesProjection
      ? `年の途中（給与${registeredSalaryCount}か月分の実績 ＋ 残り${projected.salaryMonths}か月分の見込み）`
      : `実績のみ（給与${registeredSalaryCount}か月分・賞与${registeredBonusCount}件を登録済み）`;

  const oneStopEligible = donations.donationCount > 0 ? donations.municipalityCount <= 5 : null;

  const assumptions = [
    "扶養親族なし（配偶者控除・扶養控除は非対応）として計算しています。",
    "対応している所得控除は、給与所得控除・社会保険料控除・生命保険料控除（一般／介護医療／個人年金）・基礎控除・寄附金控除（ふるさと納税）のみです。",
    "住宅ローン控除・医療費控除・iDeCo（小規模企業共済等掛金控除）・障害者控除・ひとり親控除などは反映していません。",
    "給与所得控除・基礎控除は令和7年分以降の税制の速算式を使っています。",
    "住民税の均等割・森林環境税は全国標準額で、自治体独自の上乗せ課税は反映していません。",
    "定額減税（令和6年分）は0円として計算しています。",
    "ふるさと納税の上限額は見込み年収・見込み社会保険料をもとにした目安で、実際の上限額は確定した年収で決まります。",
    "所得税・住民税の試算は、登録済みの給与・賞与だけを集計した実績ベースの金額です。",
    "寄付済額は、寄付明細の合計に「明細に載せていない調整額」を足した額です。",
  ];

  const unconfirmed: string[] = [];
  if (projected.salaryMonths > 0) {
    unconfirmed.push(
      `給与が${projected.salaryMonths}か月分未登録で、直近の給与と同水準として見込んでいます。`
    );
  }
  if (projected.bonusMonths.length > 0) {
    unconfirmed.push(
      `賞与${projected.bonusMonths.join("月・")}月分が未登録で、前年同月の支給額を見込んでいます。`
    );
  }
  if (
    premiums.lifeInsuranceGeneral === 0 &&
    premiums.lifeInsuranceCareMedical === 0 &&
    premiums.lifeInsurancePension === 0
  ) {
    unconfirmed.push("生命保険料の年間支払額が未登録で、生命保険料控除を0円として計算しています。");
  }
  if (furusato.donated === 0) {
    unconfirmed.push("ふるさと納税の寄付額が未登録です（0円として計算しています）。");
  }
  if (oneStopEligible === false) {
    unconfirmed.push(
      `寄付先が${donations.municipalityCount}自治体のため、ワンストップ特例（5自治体まで）は使えず確定申告が必要です。`
    );
  }
  if (donations.oneStopPendingCount > 0) {
    unconfirmed.push(`ワンストップ特例が未申請の寄付が${donations.oneStopPendingCount}件あります。`);
  }
  if (donations.certificatePendingCount > 0) {
    unconfirmed.push(`寄附金受領証明書が未取得の寄付が${donations.certificatePendingCount}件あります。`);
  }
  if (!isLocked) {
    unconfirmed.push(
      "この年の計算結果はまだ確定していません（申告書・課税決定通知書の金額での確定は行っていません）。"
    );
  }

  return {
    meta: {
      year,
      generatedAt: formatDateTime(generatedAt),
      source: appVersion ? `Asset Manager v${appVersion}` : "Asset Manager",
      dataState,
      confirmed: isLocked,
    },
    income: {
      grossIncomeActual: Math.round(actual.grossIncome),
      grossIncomeProjected: Math.round(projected.grossIncome),
      socialInsuranceActual: Math.round(actual.socialInsuranceTotal),
      socialInsuranceProjected: Math.round(projected.socialInsuranceTotal),
      incomeTaxWithheld: Math.round(actual.incomeTaxWithheldTotal),
      registeredSalaryCount,
      registeredBonusCount,
      includesProjection,
    },
    deductions: {
      lifeInsuranceGeneral: Math.round(premiums.lifeInsuranceGeneral),
      lifeInsuranceCareMedical: Math.round(premiums.lifeInsuranceCareMedical),
      lifeInsurancePension: Math.round(premiums.lifeInsurancePension),
    },
    furusatoNozei: {
      limit: Math.max(Math.round(furusato.limit), 0),
      donated: Math.round(furusato.donated),
      limitState: furusato.status,
      donatedDetailTotal: Math.round(donations.total),
      donatedAdjustment: Math.round(donations.adjustment),
      remaining: Math.max(Math.round(furusato.limit) - Math.round(furusato.donated), 0),
      donationCount: donations.donationCount,
      municipalityCount: donations.municipalityCount,
      oneStopPendingCount: donations.oneStopPendingCount,
      certificatePendingCount: donations.certificatePendingCount,
      oneStopEligible,
      donations: donations.items,
    },
    taxEstimate: {
      employmentIncome: Math.round(tax.employmentIncome),
      incomeDeductionTotal: Math.round(tax.incomeDeductionTotalForIncomeTax),
      taxableIncome: Math.round(tax.taxableIncomeForIncomeTax),
      incomeTaxRatePercent: Math.round(tax.incomeTaxRate * 1000) / 10,
      incomeTaxAndSurtaxTotal: Math.round(tax.incomeTaxAndSurtaxTotal),
      taxReturnPayment: Math.round(tax.taxReturnPayment),
      residentTaxAnnualTotal: Math.round(tax.residentTaxAnnualTotal),
    },
    assumptions,
    unconfirmed,
    cautions: CAUTIONS,
  };
}

export function renderSnapshotMarkdown(snapshot: TaxSnapshot): string {
  const { meta, income, deductions, furusatoNozei: fn, taxEstimate: te } = snapshot;

  const incomeRows = [
    `| 年収（課税支給の合計・実績） | ${yen(income.grossIncomeActual)} | 給与${income.registeredSalaryCount}か月分・賞与${income.registeredBonusCount}件を登録済み |`,
    income.includesProjection
      ? `| 見込み年収 | ${yen(income.grossIncomeProjected)} | 未登録分を見込んだ金額 |`
      : null,
    `| 社会保険料（実績） | ${yen(income.socialInsuranceActual)} | 健康保険・厚生年金・雇用保険の合計 |`,
    income.includesProjection
      ? `| 見込み社会保険料 | ${yen(income.socialInsuranceProjected)} | 未登録分を見込んだ金額 |`
      : null,
    `| 源泉徴収税額（実績） | ${yen(income.incomeTaxWithheld)} | 給与・賞与から天引きされた所得税 |`,
  ].filter((row): row is string => row !== null);

  return [
    `# 税務スナップショット（${meta.year}年分）`,
    "",
    `- 生成日時: ${meta.generatedAt}`,
    `- 出力元: ${meta.source}`,
    `- データの状態: ${meta.dataState}`,
    "",
    "## 収入・社会保険料",
    "",
    "| 項目 | 金額 | 補足 |",
    "| --- | --- | --- |",
    ...incomeRows,
    "",
    "## 生命保険料（年間支払額）",
    "",
    "| 区分 | 支払額 |",
    "| --- | --- |",
    `| 一般生命保険料 | ${yen(deductions.lifeInsuranceGeneral)} |`,
    `| 介護医療保険料 | ${yen(deductions.lifeInsuranceCareMedical)} |`,
    `| 個人年金保険料 | ${yen(deductions.lifeInsurancePension)} |`,
    "",
    "## ふるさと納税",
    "",
    "| 項目 | 値 |",
    "| --- | --- |",
    `| 上限額の目安 | ${yen(fn.limit)} |`,
    `| 寄付済額（明細合計 + 調整額） | ${yen(fn.donated)} |`,
    `| うち寄付明細の合計 | ${yen(fn.donatedDetailTotal)}（${fn.donationCount}件） |`,
    `| うち明細に載せていない調整額 | ${yen(fn.donatedAdjustment)} |`,
    `| 追加可能額（上限額 − 寄付済額） | ${yen(fn.remaining)} |`,
    `| 上限額の状態 | ${LIMIT_STATE_LABELS[fn.limitState]} |`,
    `| 寄付先の自治体数 | ${fn.municipalityCount} 自治体 |`,
    `| ワンストップ特例 未申請 | ${fn.oneStopPendingCount} 件 |`,
    `| 寄附金受領証明書 未取得 | ${fn.certificatePendingCount} 件 |`,
    "",
    ...(fn.donations.length > 0
      ? [
          "### 寄付明細",
          "",
          "| 寄付日 | 金額 | ワンストップ特例 | 寄附金受領証明書 |",
          "| --- | --- | --- | --- |",
          ...fn.donations.map(
            (d) =>
              `| ${d.donatedAt} | ${yen(d.amount)} | ${ONE_STOP_LABELS[d.oneStopStatus] ?? d.oneStopStatus} | ${CERTIFICATE_LABELS[d.certificateStatus] ?? d.certificateStatus} |`
          ),
          "",
        ]
      : []),
    "## 所得税・住民税の試算（実績ベース）",
    "",
    "| 項目 | 金額 |",
    "| --- | --- |",
    `| 給与所得額 | ${yen(te.employmentIncome)} |`,
    `| 所得控除額の合計 | ${yen(te.incomeDeductionTotal)} |`,
    `| 課税される所得金額 | ${yen(te.taxableIncome)} |`,
    `| 所得税率 | ${te.incomeTaxRatePercent} % |`,
    `| 所得税及び復興特別所得税の額 | ${yen(te.incomeTaxAndSurtaxTotal)} |`,
    `| 申告納税額（マイナスは還付） | ${yen(te.taxReturnPayment)} |`,
    `| 住民税（年額の見積り） | ${yen(te.residentTaxAnnualTotal)} |`,
    "",
    "## 計算の前提",
    "",
    ...snapshot.assumptions.map((line) => `- ${line}`),
    "",
    "## 未確認・未完了の項目",
    "",
    ...(snapshot.unconfirmed.length > 0
      ? snapshot.unconfirmed.map((line) => `- ${line}`)
      : ["- 未確認の項目はありません。"]),
    "",
    "## 注意",
    "",
    ...snapshot.cautions.map((line) => `- ${line}`),
    "",
  ].join("\n");
}

export function renderSnapshotJson(snapshot: TaxSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

export function buildSnapshotText(
  snapshot: TaxSnapshot,
  purpose: SnapshotPurpose,
  format: SnapshotFormat
): string {
  const selected = SNAPSHOT_PURPOSES.find((p) => p.key === purpose) ?? SNAPSHOT_PURPOSES[0];
  const intro = `${PROMPT_PREAMBLE}\n\n${selected.prompt}`;
  if (format === "json") {
    return `${intro}\n\n\`\`\`json\n${renderSnapshotJson(snapshot)}\n\`\`\`\n`;
  }
  return `${intro}\n\n${renderSnapshotMarkdown(snapshot)}`;
}
