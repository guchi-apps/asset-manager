/**
 * 取り込んだ詳細明細（メール・外部アプリ等）の整理（Issue #658）。
 *
 * 削除してよいか、を判定する**純粋関数**だけを置く。
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
    /** 家計簿の取引に付いているか（#886）。付いたまま消すと取引の根拠だけが消える。 */
    ledgerEntryId: number | null
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
 * 物理削除してよい明細か。Zaim登録済み（旧運用）・登録途中・家計簿の取引に付いているものは履歴と二重登録防止のため削除させない。
 * `deleteReceipt` も同じ判定を通す。
 */
export function judgeDeletable(
    receipt: Pick<
        CleanupReceiptInput,
        "status" | "ledgerEntryId" | "zaimMoneyId" | "sentToZaimAt" | "zaimRegisterError"
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
    if (receipt.ledgerEntryId !== null) {
        return {
            deletable: false,
            reason: "家計簿の取引に付いているため削除できません。詳細画面で家計簿から外してください",
        }
    }
    return { deletable: true, reason: null }
}
