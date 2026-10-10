/**
 * レシートをZaimへどの単位で登録するか（Issue #687）。**純粋関数。**
 *
 * 1回の買い物は、商品が複数あっても**1件のZaim取引**（親子構造）として登録する。以前は商品ごとに
 * 独立した取引を作っており、履歴に商品の数だけ行が並んでいた。
 *
 * 旧経路で登録したレシート（商品ごとに `zaimRegisteredAt` が付いているが `zaimReceiptRequestId` が無い）は、
 * 新経路で送ると**同じ商品がZaimに二重に載る**。送らずに止めて、人が確認してまとめ直す。
 */

export interface RegisterPlanItem {
    zaimRegisteredAt: Date | null
}

export interface RegisterPlanReceipt {
    zaimReceiptRequestId: string | null
    items: RegisterPlanItem[]
}

/** none=分割登録ではない / partial=旧経路で一部の商品だけ登録済み / complete=旧経路で全商品登録済み */
export type SplitRegistration = "none" | "partial" | "complete"

export function detectSplitRegistration(receipt: RegisterPlanReceipt): SplitRegistration {
    if (receipt.zaimReceiptRequestId) return "none"
    if (receipt.items.length < 2) return "none"
    const registered = receipt.items.filter((item) => item.zaimRegisteredAt !== null).length
    if (registered === 0) return "none"
    return registered === receipt.items.length ? "complete" : "partial"
}

export function describeSplitRegistration(
    kind: Exclude<SplitRegistration, "none">,
    registered: number,
    total: number
): string {
    const state =
        kind === "partial"
            ? "商品ごとに分けて " + registered + "/" + total + " 件だけ登録されています"
            : "商品ごとに分けて全 " + total + " 件が登録されています"
    return (
        "このレシートは旧方式で" +
        state +
        "。新しい方式（1回の買い物を1件で登録）で送ると同じ商品が二重に載るため、送りません。" +
        "Zaimの反映待ち口座でこのレシートの取引（メモ「Asset Manager レシート取込 #番号」）を確認し、" +
        "不要な分を人の手でZaimから削除してから、レシートの登録状態を戻して送り直してください"
    )
}
