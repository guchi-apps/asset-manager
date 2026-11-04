/**
 * 金額が「金額ずれ」とみなせるほど近いかの判定（Issue #483）。
 *
 * 為替換算したGmailの明細などは、カード会社の換算でカード明細の金額と数円〜数十円ずれる。
 * カード明細との対応付け（`lib/receipt-triage.ts`）・取り込み明細の整理（`lib/receipt-cleanup.ts`）・
 * カード明細の金額へ合わせる操作（`alignReceiptAmountToZaim`）が同じ基準を使う。
 *
 * 以前はここにZaimのカード連携明細と当アプリの明細を1対1に突き合わせる `reconcileReceipts` も置いていたが、
 * Zaimへの登録・置き換え（旧運用）の廃止（Issue #823）で使われなくなったため削除した。
 */

/** 「金額ずれ」とみなす差の割合（Zaim側の金額に対して）。Issue #483。 */
export const AMOUNT_GAP_RATIO = 0.05
/** 「金額ずれ」とみなす差の下限（円）。少額の買い物でも数十円の換算差は起きるため、割合と大きいほうを使う。 */
export const AMOUNT_GAP_MIN_YEN = 50

/** 2つの金額が「金額ずれ」とみなせるほど近いか。一致は含めない。 */
export function isNearAmount(zaimAmount: number, appAmount: number): boolean {
    const diff = Math.abs(zaimAmount - appAmount)
    if (diff === 0) return false
    return diff <= Math.max(Math.abs(zaimAmount) * AMOUNT_GAP_RATIO, AMOUNT_GAP_MIN_YEN)
}
