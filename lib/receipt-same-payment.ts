import type { Prisma } from "@prisma/client"

/**
 * 同じ支払いとして紐付けた明細（`setAsideReason = SAME_PAYMENT`・`setAsideForReceiptId = 代表`）を、代表と同じ取引へ連れて付ける（#1564）。
 * 紐付けた側は一覧には出ないが、取引の根拠（レシート・メール）としては代表と一緒に付く。
 * 付け替えの連鎖は `setAsideReceipt` が代表へ張り直すので、`setAsideForReceiptId` は常に最終の代表を指す（1段）。
 */
export async function attachSamePaymentFollowers(
    tx: Prisma.TransactionClient,
    userId: string,
    representativeId: number,
    entryId: number,
    accountId: number | null
): Promise<number> {
    const result = await tx.receiptImport.updateMany({
        where: { userId, setAsideReason: "SAME_PAYMENT", setAsideForReceiptId: representativeId, ledgerEntryId: null },
        data: { ledgerEntryId: entryId, ledgerAccountId: accountId },
    })
    return result.count
}

/** 代表を取引から外すとき、連れて付いた明細も同じ取引から外す。 */
export async function detachSamePaymentFollowers(tx: Prisma.TransactionClient, userId: string, representativeId: number, entryId: number): Promise<number> {
    const result = await tx.receiptImport.updateMany({
        where: { userId, setAsideReason: "SAME_PAYMENT", setAsideForReceiptId: representativeId, ledgerEntryId: entryId },
        data: { ledgerEntryId: null, ledgerAccountId: null },
    })
    return result.count
}

/** `unregisterReceiptFromLedger` の「ほかの根拠」の数から、連れて付いた明細を除く。 */
export function otherEvidenceCount(totalOthers: number, followers: number): number {
    return Math.max(0, totalOthers - followers)
}
