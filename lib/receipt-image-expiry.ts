/**
 * レシート画像の自動削除（Issue #1118）。
 *
 * 画像はサーバーのファイルシステムに溜まり容量を圧迫するため、取り込みから一定期間（30日）が過ぎたものを消す。
 * 消すのは画像ファイルと `imagePath` / `imageMimeType` だけ。明細・金額と、同じ写真の再取り込みを検知する
 * `imageHash` は残す（`imageHash` が残っていて `imagePath` が無い行が「画像を削除済み」の目印）。
 *
 * 起点は取り込み日時（`createdAt`）で、購入日ではない。
 */
import { prisma } from "@/lib/prisma"
import { deleteReceiptImage } from "@/lib/receipt-storage"

/** 画像を残す日数 */
export const RECEIPT_IMAGE_RETENTION_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

/** これより前に取り込んだ画像が削除の対象 */
export function receiptImageExpiryCutoff(now: Date): Date {
    return new Date(now.getTime() - RECEIPT_IMAGE_RETENTION_DAYS * DAY_MS)
}

export interface ExpiredReceiptImage {
    id: number
    imagePath: string
}

export interface ReceiptImageExpiryDeps {
    findExpired(cutoff: Date): Promise<ExpiredReceiptImage[]>
    removeFile(imagePath: string): Promise<void>
    clearRecord(id: number): Promise<void>
}

export interface ReceiptImageExpiryResult {
    deleted: number
    failed: number
}

/**
 * 期限切れの画像を1件ずつ消す。ファイルの削除が済んだ行だけDBを更新する（逆順だとファイルだけが残って孤児になる）。
 * 1件の失敗で全体を止めない。
 */
export async function expireReceiptImages(deps: ReceiptImageExpiryDeps, now: Date): Promise<ReceiptImageExpiryResult> {
    const targets = await deps.findExpired(receiptImageExpiryCutoff(now))
    let deleted = 0
    let failed = 0
    for (const target of targets) {
        try {
            await deps.removeFile(target.imagePath)
            await deps.clearRecord(target.id)
            deleted += 1
        } catch (error) {
            failed += 1
            console.error(`レシート画像の削除に失敗しました（id=${target.id}）:`, error)
        }
    }
    return { deleted, failed }
}

/** 全ユーザーの期限切れ画像を削除する（定期処理から呼ぶ） */
export function deleteExpiredReceiptImages(now: Date = new Date()): Promise<ReceiptImageExpiryResult> {
    return expireReceiptImages(
        {
            findExpired: async (cutoff) => {
                const rows = await prisma.receiptImport.findMany({
                    where: { imagePath: { not: null }, createdAt: { lt: cutoff } },
                    select: { id: true, imagePath: true },
                    orderBy: { id: "asc" },
                })
                return rows.flatMap((row) => (row.imagePath === null ? [] : [{ id: row.id, imagePath: row.imagePath }]))
            },
            removeFile: deleteReceiptImage,
            clearRecord: async (id) => {
                await prisma.receiptImport.update({ where: { id }, data: { imagePath: null, imageMimeType: null } })
            },
        },
        now
    )
}
