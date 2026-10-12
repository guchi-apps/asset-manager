// 寄付（ふるさと納税）の年間サマリーの型と、調整額を足した実効額の計算。
// 寄付明細そのものの正本は #715 の `FurusatoDonation`。ここは「税務側が受け取る形」を決めるだけで、
// `db` に依存させない（クライアント・単体テストから使うため）。
// 実際の読み出しは `lib/tax/donation-source.ts` に閉じている。

/** スナップショットへ載せる寄付明細1件。自治体名は含めない（識別情報を出さない方針） */
export type DonationItem = {
  /** 寄付日（YYYY-MM-DD） */
  donatedAt: string;
  amount: number;
  /** "notApplied" | "applied" | "accepted" | "switchedToTaxReturn" */
  oneStopStatus: string;
  /** "notReceived" | "received" | "notNeeded" */
  certificateStatus: string;
};

/** 寄付明細だけから出した年間サマリー（調整額を含まない） */
export type DonationDetailSummary = {
  /** 寄付明細の合計額 */
  total: number;
  donationCount: number;
  /** 直近の寄付日（ISO文字列）。明細が無ければ null */
  lastDonationDate: string | null;
  /** 寄付先自治体数（重複を除く） */
  municipalityCount: number;
  oneStopPendingCount: number;
  certificatePendingCount: number;
  items: DonationItem[];
};

export const EMPTY_DONATION_DETAIL: DonationDetailSummary = {
  total: 0,
  donationCount: 0,
  lastDonationDate: null,
  municipalityCount: 0,
  oneStopPendingCount: 0,
  certificatePendingCount: 0,
  items: [],
};

/** 税計算・残り枠・スナップショットが使う寄付サマリー。`effectiveTotal` が唯一の「寄付済額」 */
export type DonationSummary = DonationDetailSummary & {
  /** 明細に載せていない調整額（`Deduction.furusatoNozei`） */
  adjustment: number;
  /** 明細合計 + 調整額 */
  effectiveTotal: number;
  /** "donations": 寄付明細がある / "deduction": 明細が無く調整額だけ */
  source: "deduction" | "donations";
};

export function withAdjustment(detail: DonationDetailSummary, adjustment: number): DonationSummary {
  return {
    ...detail,
    adjustment,
    effectiveTotal: detail.total + adjustment,
    source: detail.donationCount > 0 ? "donations" : "deduction",
  };
}
