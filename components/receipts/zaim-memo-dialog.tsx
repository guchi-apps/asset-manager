"use client"

/**
 * 置き換えできない連携明細（銀行・デビット）のメモを書くダイアログ（Issue #514）。
 *
 * Zaimの「置き換え」はカード・電子マネーの連携明細にしか効かない（`lib/zaim-account-kind.ts`）。
 * 銀行・デビットの明細はアプリの明細で置き換えられないので、代わりに**その連携明細のメモへ
 * 買った物を書き込む**。下書きはアプリの明細の品目から作る（`lib/zaim-memo-draft.ts`）。
 *
 * **AIDE側の受け口はまだ無い**（`lib/zaim-web-memo.ts`）。書き込みが `notImplemented` で
 * 止まっている間も使えるように、同じ本文をコピーしてZaimアプリへ貼れるようにしてある。
 */

import * as React from "react"
import { Check, Copy, Loader2, Wand2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { formatYen } from "@/components/receipts/receipt-status"
import { formatDayKey } from "@/components/receipts/replace-targets"
import { getZaimMemoDraftAction, writeZaimEntryMemoAction } from "@/app/actions/receipts"
import { ZAIM_MEMO_MAX_LENGTH } from "@/lib/zaim-memo-draft"

/** 書き込む相手の連携明細と、下書きの材料にするアプリの明細。 */
export interface ZaimMemoTarget {
    /** Zaim明細id。AIDEが編集リンクから読めなかった行は null で、書き込みはできない。 */
    moneyId: number | null
    date: string
    amount: number
    account: string
    /** 相手の表示名（お店・品目）。 */
    title: string
    /** AIDEが最後に巡回した時点のメモ。 */
    comment: string
    /** 組になったアプリの明細id。無ければ下書きを作らない。 */
    receiptId: number | null
}

export function ZaimMemoDialog({
    target,
    onClose,
    onWritten,
}: {
    target: ZaimMemoTarget | null
    onClose: () => void
    /** 書き込めたあと。画面の「いまのメモ」を書き換えるために返す。 */
    onWritten: (moneyId: number, comment: string) => void
}) {
    const [text, setText] = React.useState("")
    const [drafting, setDrafting] = React.useState(false)
    const [writing, setWriting] = React.useState(false)
    const receiptId = target?.receiptId ?? null

    // 開いたときの初期値。すでにメモがあればそれを、無ければ品目から作った下書きを出す。
    React.useEffect(() => {
        if (!target) return
        setText(target.comment)
        if (target.comment || receiptId === null) return
        let cancelled = false
        setDrafting(true)
        getZaimMemoDraftAction(receiptId)
            .then((result) => {
                if (cancelled) return
                if (result.success) setText(result.data)
                else toast.error(result.error)
            })
            .finally(() => {
                if (!cancelled) setDrafting(false)
            })
        return () => {
            cancelled = true
        }
        // target の中身ではなく「どの明細を開いたか」で読み直す。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [target?.moneyId, target?.comment, receiptId])

    const redraft = async () => {
        if (receiptId === null) return
        setDrafting(true)
        try {
            const result = await getZaimMemoDraftAction(receiptId)
            if (!result.success) {
                toast.error(result.error)
                return
            }
            if (!result.data) {
                toast.error("この明細には品目が無いため、下書きを作れません")
                return
            }
            setText(result.data)
        } finally {
            setDrafting(false)
        }
    }

    const write = async () => {
        if (!target || target.moneyId === null) return
        setWriting(true)
        try {
            const result = await writeZaimEntryMemoAction(target.moneyId, text)
            if (!result.success) {
                toast.error(result.error)
                return
            }
            toast.success(
                result.data.duplicated
                    ? "同じメモがすでに書き込まれています"
                    : "Zaimの明細にメモを書き込みました"
            )
            onWritten(target.moneyId, result.data.comment)
            onClose()
        } finally {
            setWriting(false)
        }
    }

    const busy = writing || drafting
    const overLimit = text.length > ZAIM_MEMO_MAX_LENGTH

    return (
        <Dialog open={target !== null} onOpenChange={(open) => !open && !writing && onClose()}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Zaimの明細にメモを書きますか？</DialogTitle>
                    <DialogDescription>
                        銀行・デビットの連携明細は置き換えできないため、この連携明細のメモへ直接書き込みます。金額・日付・口座・内訳は変えません。
                    </DialogDescription>
                </DialogHeader>
                {target && (
                    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-md bg-muted px-3 py-2 text-sm">
                        <dt className="text-muted-foreground">相手</dt>
                        <dd className="break-all">{target.title}</dd>
                        <dt className="text-muted-foreground">日付・金額</dt>
                        <dd className="tabular-nums">
                            {formatDayKey(target.date)}・{formatYen(target.amount)}
                        </dd>
                        <dt className="text-muted-foreground">口座</dt>
                        <dd className="break-all">{target.account || "（口座不明）"}</dd>
                        <dt className="text-muted-foreground">いまのメモ</dt>
                        <dd className="break-all">{target.comment || "（空）"}</dd>
                    </dl>
                )}
                <Textarea
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    maxLength={ZAIM_MEMO_MAX_LENGTH}
                    rows={3}
                    disabled={busy}
                    placeholder="買った物や内訳を書きます（例: おにぎり 158円／カフェオレ 138円）"
                    aria-label="Zaimの明細に書き込むメモ"
                />
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{drafting ? "アプリの明細から下書きを作っています…" : ""}</span>
                    <span className={overLimit ? "text-destructive tabular-nums" : "tabular-nums"}>
                        {text.length} / {ZAIM_MEMO_MAX_LENGTH}
                    </span>
                </div>
                <div className="flex flex-wrap gap-2">
                    {receiptId !== null && (
                        <Button variant="outline" size="sm" onClick={() => void redraft()} disabled={busy}>
                            {drafting ? <Loader2 className="animate-spin" /> : <Wand2 />}
                            アプリの明細から作り直す
                        </Button>
                    )}
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={!text}
                        onClick={() => {
                            void navigator.clipboard.writeText(text)
                            toast.success("コピーしました。Zaimアプリのメモへ貼り付けてください")
                        }}
                    >
                        <Copy />
                        コピー
                    </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                    書き込むと、いまのメモは置き換わります。Zaimの一覧への反映はAIDEの次の巡回（1日2回）後です。
                    {target?.moneyId === null &&
                        " この明細はAIDEが明細idを読めていないため、書き込みはできません。コピーしてZaimアプリで貼り付けてください。"}
                </p>
                <DialogFooter className="flex-row gap-2">
                    <Button variant="outline" className="flex-1" onClick={onClose} disabled={writing}>
                        やめる
                    </Button>
                    <Button
                        className="flex-1"
                        onClick={() => void write()}
                        disabled={busy || target?.moneyId == null || overLimit}
                    >
                        {writing ? <Loader2 className="animate-spin" /> : <Check />}
                        Zaimへ書き込む
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
