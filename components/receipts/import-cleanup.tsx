"use client"

import * as React from "react"
import { EyeOff, Loader2, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    deleteReceiptsAction,
    listImportedReceiptsAction,
    setAsideReceiptAction,
} from "@/app/actions/receipts"
import { formatYen } from "@/components/receipts/receipt-status"
import type { ImportedReceiptRow } from "@/lib/receipt-service"

function sourceLabel(source: string): string {
    return { GMAIL: "Gmail", EXTERNAL_APP: "外部アプリ", SMART_RECEIPT: "スマートレシート", AMAZON: "Amazon" }[source] ?? source
}

function day(value: string | null): string {
    return value?.replaceAll("-", "/") ?? "日付なし"
}

/** 削除前の確認ダイアログ。対象の店舗・日付・金額と件数を見せる。 */
function ConfirmDeleteDialog({
    rows,
    deleting,
    onCancel,
    onConfirm,
}: {
    rows: ImportedReceiptRow[]
    deleting: boolean
    onCancel: () => void
    onConfirm: () => void
}) {
    return (
        <Dialog open={rows.length > 0} onOpenChange={(open) => { if (!open && !deleting) onCancel() }}>
            <DialogContent className="max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{rows.length}件の取り込み明細を削除します</DialogTitle>
                    <DialogDescription>
                        Asset Managerの取り込みデータだけを削除します。Zaimのカード明細・元のメール・外部アプリの記録は変更しません。同じ明細は再取り込みしても復活しません。
                    </DialogDescription>
                </DialogHeader>
                <ul className="space-y-1 text-sm">
                    {rows.map((row) => (
                        <li key={row.id} className="flex flex-wrap justify-between gap-x-3 border-b py-1">
                            <span>{day(row.purchasedDate)} {row.storeName ?? "店舗名なし"}</span>
                            <span className="tabular-nums">{formatYen(row.totalAmount)}</span>
                        </li>
                    ))}
                </ul>
                <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={onCancel} disabled={deleting}>キャンセル</Button>
                    <Button variant="destructive" onClick={onConfirm} disabled={deleting}>
                        {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}{rows.length}件を削除
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

function useDeletion(onDone: () => Promise<unknown>) {
    const [pending, setPending] = React.useState<ImportedReceiptRow[]>([])
    const [deleting, setDeleting] = React.useState(false)
    const confirm = async () => {
        setDeleting(true)
        try {
            const result = await deleteReceiptsAction(pending.map((row) => row.id))
            if (!result.success) return toast.error(result.error)
            const { deleted, failed } = result.data
            if (deleted.length > 0) toast.success(`${deleted.length}件を削除しました`)
            if (failed.length > 0) toast.error(`${failed.length}件は削除できませんでした: ${failed[0].error}`)
            setPending([])
            await onDone()
        } finally { setDeleting(false) }
    }
    return { pending, setPending, deleting, confirm }
}

function RowHeader({ row }: { row: ImportedReceiptRow }) {
    return (
        <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <div className="min-w-0">
                    <Badge variant="outline">{sourceLabel(row.source)}</Badge>
                    <span className="ml-2 break-words font-medium">{row.storeName ?? "店舗名なし"}</span>
                </div>
                <span className="font-semibold tabular-nums">{formatYen(row.totalAmount)}</span>
            </div>
            <p className="mt-1 break-words text-xs text-muted-foreground">
                {day(row.purchasedDate)}{row.itemNames.length > 0 ? " ・ " + row.itemNames.join(" / ") : ""}
            </p>
        </div>
    )
}

/** 取り込んだ詳細明細を、カード候補の有無に関わらず一覧して個別・一括で削除する。 */
export function ImportedReceiptList() {
    const [rows, setRows] = React.useState<ImportedReceiptRow[] | null>(null)
    const [selected, setSelected] = React.useState<Set<number>>(new Set())
    const load = React.useCallback(async () => {
        const result = await listImportedReceiptsAction()
        if (!result.success) return toast.error(result.error)
        setRows(result.data)
        setSelected(new Set())
    }, [])
    React.useEffect(() => { void load() }, [load])
    const { pending, setPending, deleting, confirm } = useDeletion(load)
    const [settingAside, setSettingAside] = React.useState<number | null>(null)
    // 削除せずに作業一覧から外す（#768）。行は残るので「使わない明細」から戻せる。
    const setAside = async (id: number) => {
        setSettingAside(id)
        try {
            const result = await setAsideReceiptAction(id)
            if (!result.success) return toast.error(result.error)
            toast.success("使わないにしました。「使わない明細」から戻せます")
            await load()
        } finally { setSettingAside(null) }
    }

    if (rows === null) return <div className="flex min-h-32 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 animate-spin" />読み込んでいます…</div>
    const deletable = rows.filter((row) => row.deletable)
    const toggle = (id: number, on: boolean) => setSelected((prev) => { const next = new Set(prev); if (on) next.add(id); else next.delete(id); return next })
    const chosen = rows.filter((row) => selected.has(row.id))

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                        checked={deletable.length > 0 && selected.size === deletable.length}
                        onCheckedChange={(on) => setSelected(on ? new Set(deletable.map((row) => row.id)) : new Set())}
                        disabled={deletable.length === 0}
                    />
                    すべて選択（{selected.size}/{deletable.length}件）
                </label>
                <Button variant="destructive" size="sm" disabled={chosen.length === 0} onClick={() => setPending(chosen)}>
                    <Trash2 />選択した{chosen.length}件を削除
                </Button>
            </div>
            {rows.length === 0 ? <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">取り込み明細はありません。</CardContent></Card> : rows.map((row) => (
                <Card key={row.id}>
                    <CardContent className="flex items-start gap-3 py-3">
                        <Checkbox className="mt-1" checked={selected.has(row.id)} disabled={!row.deletable} onCheckedChange={(on) => toggle(row.id, on === true)} aria-label="選択" />
                        <div className="min-w-0 flex-1 space-y-2">
                            <RowHeader row={row} />
                            {row.deletable ? (
                                <div className="flex flex-wrap gap-2">
                                    <Button variant="outline" size="sm" onClick={() => void setAside(row.id)} disabled={settingAside !== null}>{settingAside === row.id ? <Loader2 className="animate-spin" /> : <EyeOff />}使わない</Button>
                                    <Button variant="outline" size="sm" onClick={() => setPending([row])}><Trash2 />削除</Button>
                                </div>
                            ) : (
                                <p className="text-xs text-muted-foreground">{row.blockedReason}</p>
                            )}
                        </div>
                    </CardContent>
                </Card>
            ))}
            <ConfirmDeleteDialog rows={pending} deleting={deleting} onCancel={() => setPending([])} onConfirm={() => void confirm()} />
        </div>
    )
}
