/**
 * スマートレシート・Amazon由来の明細を、家計簿の取り込みに続けて自動で取り込む（Issue #1005）。
 *
 * 取り込み（`importLinkedReceipts`）の入口は画面の「詳細明細を探す」だけで、#886 でそれを消したあと
 * 呼び出し元が無くなり、スマートレシートがレシート一覧に出なくなっていた。いまは家計簿の取り込み
 * （定期実行 `scripts/ledger-sync.ts` と画面の「今すぐ取り込む」）が成功したあとに、ここを呼ぶ。
 *
 * 新しく作ったもののうち自動確定したものだけを家計簿へ登録する（`registerAutoConfirmedLinkedReceipts`）。
 * 確認待ちのものは一覧に「家計簿に未登録」として出し、人が詳細画面で確かめてから登録する。
 */
import { importLinkedReceipts, type LinkedImportResult } from "@/lib/receipt-service"
import { registerAutoConfirmedLinkedReceipts, type BulkRegisterResult } from "@/lib/ledger-receipt-service"
import type { AideMoneyPayload } from "@/lib/zaim-aide-money"

export interface LinkedReceiptSyncResult {
    imported: LinkedImportResult
    registered: BulkRegisterResult
}

/** `aidePayload` は家計簿の取り込みで取得済みのAIDEの明細一覧。渡せばAIDEへ取りに行かない（#1090） */
export async function syncLinkedReceipts(
    userId: string,
    options: { aidePayload?: AideMoneyPayload } = {}
): Promise<LinkedReceiptSyncResult> {
    const imported = await importLinkedReceipts(userId, { aidePayload: options.aidePayload })
    const registered = await registerAutoConfirmedLinkedReceipts(userId, imported.createdIds)
    return { imported, registered }
}

/** 取り込みの結果を1行の文にする（定期実行のログと「今すぐ取り込む」のメッセージに使う）。件数が0のものは書かない。 */
export function describeLinkedReceiptSync(result: LinkedReceiptSyncResult): string {
    const { imported, registered } = result
    const parts: string[] = []
    if (imported.created > 0) parts.push(`新しく ${imported.created}件`)
    if (imported.updated > 0) parts.push(`明細を追加 ${imported.updated}件`)
    if (registered.created > 0) parts.push(`家計簿へ反映待ちで登録 ${registered.created}件`)
    if (registered.attached > 0) parts.push(`家計簿の取引に付けた ${registered.attached}件`)
    if (registered.heldStatements > 0) parts.push(`カード明細を照合待ちに ${registered.heldStatements}件`)
    if (registered.choose > 0) parts.push(`付け先の候補が複数 ${registered.choose}件`)
    if (registered.failed.length > 0) parts.push(`登録に失敗 ${registered.failed.length}件`)
    if (parts.length === 0) return "スマートレシート・Amazon: 新しい明細はありません"
    return `スマートレシート・Amazon: ${parts.join("・")}`
}
