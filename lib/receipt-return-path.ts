/**
 * レシート確認画面から戻る先の決定（Issue #1297）。
 * 撮影を始めた画面のパスを `?from=` で確認画面へ引き継ぎ、登録が済んだらそこへ戻す。
 * `router.back()` は履歴が無い（直開き・新規タブ・PWA）と何も起きないため使わない。
 */
export const RECEIPT_LIST_PATH = "/receipts"

/** `from` に使えるのは同一オリジンのパスだけ（外部URL・プロトコル相対・バックスラッシュ・制御文字は不可）。 */
function isSafePath(value: string): boolean {
    if (!value.startsWith("/") || value.startsWith("//")) return false
    return !/[\\\u0000-\u001f]/.test(value)
}

/** 撮影を始めた画面のパスから、確認画面へ付ける `from` を決める。確認画面自身（`/receipts/<id>`）は戻り先にしない。 */
export function pickReturnFrom(currentPath: string): string | null {
    if (!isSafePath(currentPath)) return null
    if (currentPath.startsWith(RECEIPT_LIST_PATH + "/")) return null
    return currentPath
}

/** 確認画面を開くパス。`from` があれば戻り先として付ける。 */
export function buildReceiptDetailPath(receiptId: number, from: string | null): string {
    const base = RECEIPT_LIST_PATH + "/" + receiptId
    return from ? base + "?from=" + encodeURIComponent(from) : base
}

/** 登録後の戻り先。`from` が無い・安全でない・確認画面自身のときは一覧。 */
export function resolveReturnPath(from: string | null | undefined): string {
    if (!from || !isSafePath(from)) return RECEIPT_LIST_PATH
    if (from.startsWith(RECEIPT_LIST_PATH + "/")) return RECEIPT_LIST_PATH
    return from
}
