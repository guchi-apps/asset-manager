/**
 * 取り込んだ詳細明細（メール・外部アプリ等）の整理（Issue #658）。
 *
 * 削除してよいか・カード明細との対応を解除してよいか、を判定する**純粋関数**だけを置く。
 * Zaimの連携明細に反映済みの取り込み明細を探す照合（`findCleanupCandidates`。「Zaimと照合」タブ）は、
 * Zaimへの登録・置き換え（旧運用）のための整理だったので #843 で削除した。
 */
import type { ReceiptStatus } from "@prisma/client"

export interface CleanupReceiptInput {
    id: number
    status: ReceiptStatus
    storeName: string | null
    /** YYYY-MM-DD（JST）。 */
    purchasedDate: string | null
    totalAmount: number | null
    /** 金額が概算か（為替換算など）。円建ての確定額は厳密に一致したZaim明細だけを候補にする（Issue #772）。 */
    amountApproximate: boolean
    matchedCardMoneyId: number | null
    zaimMoneyId: number | null
    sentToZaimAt: Date | null
    zaimRegisterError: string | null
}

export interface DeletableJudgement {
    deletable: boolean
    /** 削除できない理由（画面にそのまま出せる日本語）。 */
    reason: string | null
}

/**
 * 物理削除してよい明細か。登録済み・登録途中・カード対応付け済みは履歴と二重登録防止のため削除させない。
 * `deleteReceipt` も同じ判定を通す。
 */
export function judgeDeletable(
    receipt: Pick<
        CleanupReceiptInput,
        "status" | "matchedCardMoneyId" | "zaimMoneyId" | "sentToZaimAt" | "zaimRegisterError"
    >
): DeletableJudgement {
    if (receipt.status === "SENT_TO_ZAIM" || receipt.status === "REPLACED") {
        return { deletable: false, reason: "Zaimへ登録済みのため削除できません" }
    }
    if (receipt.status === "MANUAL_ACTION_REQUIRED") {
        return {
            deletable: false,
            reason: "Zaimへの登録が途中で止まっているため削除できません。Zaimを確認してから登録し直してください",
        }
    }
    if (
        receipt.zaimMoneyId !== null ||
        receipt.sentToZaimAt !== null ||
        receipt.zaimRegisterError
    ) {
        return { deletable: false, reason: "Zaimへの登録の記録があるため削除できません" }
    }
    if (receipt.matchedCardMoneyId !== null) {
        return {
            deletable: false,
            reason: "カード明細と対応付け済みのため削除できません（対応の履歴を保持します）",
        }
    }
    return { deletable: true, reason: null }
}

export interface UnmatchableJudgement {
    unmatchable: boolean
    /** 解除できない理由（画面にそのまま出せる日本語）。 */
    reason: string | null
}

/**
 * カード明細との対応付けを解除してよいか（#776）。Zaimへ登録する前だけ許す。
 * 登録後に外すと、Zaim側に残った反映待ちの明細と対応が食い違うため。
 */
export function judgeUnmatchable(
    receipt: Pick<
        CleanupReceiptInput,
        "status" | "matchedCardMoneyId" | "zaimMoneyId" | "sentToZaimAt" | "zaimRegisterError"
    >
): UnmatchableJudgement {
    if (receipt.matchedCardMoneyId === null) {
        return { unmatchable: false, reason: "カード明細と対応付けていません" }
    }
    if (receipt.status !== "REVIEW_REQUIRED" && receipt.status !== "CONFIRMED") {
        return { unmatchable: false, reason: "Zaimへの登録を始めているため、対応を解除できません" }
    }
    if (receipt.zaimMoneyId !== null || receipt.sentToZaimAt !== null || receipt.zaimRegisterError) {
        return { unmatchable: false, reason: "Zaimへの登録の記録があるため、対応を解除できません" }
    }
    return { unmatchable: true, reason: null }
}
