"use client"

import { ReceiptLedgerSessionProvider } from "@/components/ledger/receipt-ledger-panel"
import { ReceiptEditor } from "@/components/receipts/receipt-editor"
import type { ReceiptDetail } from "@/app/actions/receipts"

/**
 * レシート・メールの確認画面。
 *
 * 保存や再取得で商品行が入れ替わったとき、編集中の状態を作り直す（#663）ため、`ReceiptEditor` は品目idを `key` にする。
 * 保存（`updateReceipt`）は品目行を作り直してidが変わるので、保存のたびに作り直される。家計簿への登録の途中経過
 * （紐付け候補・変更内容の確認・選んだ口座）は作り直しで失わないよう、その外の `ReceiptLedgerSessionProvider` に持つ（#1521）。
 */
export function ReceiptEditorHost({ detail }: { detail: ReceiptDetail }) {
    return (
        <ReceiptLedgerSessionProvider key={detail.id}>
            <ReceiptEditor key={detail.items.map((item) => item.id).join("-")} detail={detail} />
        </ReceiptLedgerSessionProvider>
    )
}
