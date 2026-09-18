"use client"

/**
 * 設定タブの「口座の種別」（Issue #471）。
 *
 * 置き換えできるのはカード・電子マネーの連携明細だけで、銀行・デビットの連携明細は置き換えられない。
 * 種別は「Zaimのマスタを更新」で口座名などから推定し、外れていればここで選び直す。
 * 選び直した種別はマスタを取り直しても変わらない（`syncZaimMasters` が `kindManual` の行を上書きしない）。
 * ここでの設定はZaimへ送らない。
 */

import * as React from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { getZaimAccountKindsAction, saveZaimAccountKindAction } from "@/app/actions/receipts"
import type { ZaimAccountKindRow } from "@/lib/receipt-service"
import {
    ACCOUNT_KIND_HINT,
    ACCOUNT_KIND_LABEL,
    SELECTABLE_ACCOUNT_KINDS,
    type AccountKind,
} from "@/lib/zaim-account-kind"

const LEGEND_KINDS: AccountKind[] = ["CARD", "BANK", "MANUAL"]

export function AccountKindSettings({
    reloadKey,
}: {
    /** 口座マスタを取り直したら変わる値。変わったら読み直す。 */
    reloadKey: string
}) {
    const [rows, setRows] = React.useState<ZaimAccountKindRow[]>([])
    const [loading, setLoading] = React.useState(true)

    const load = React.useCallback(async () => {
        const result = await getZaimAccountKindsAction()
        if (result.success) setRows(result.data)
        else toast.error(result.error)
        setLoading(false)
    }, [])

    React.useEffect(() => {
        void load()
    }, [load, reloadKey])

    const change = async (row: ZaimAccountKindRow, kind: AccountKind) => {
        // 選んだ瞬間に反映する。失敗したら読み直して元へ戻す。
        setRows((previous) =>
            previous.map((entry) =>
                entry.zaimAccountId === row.zaimAccountId ? { ...entry, kind, kindManual: true } : entry
            )
        )
        const result = await saveZaimAccountKindAction(row.zaimAccountId, kind)
        if (!result.success) {
            toast.error(result.error)
            await load()
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">口座の種別</CardTitle>
                <CardDescription>
                    置き換えできる口座かどうかで、② 反映待ちの操作が変わります。Zaimのマスタを更新すると自動で推定します
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                <ul className="grid gap-1 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                    {LEGEND_KINDS.map((kind) => (
                        <li key={kind}>
                            <span className="font-medium text-foreground">{ACCOUNT_KIND_LABEL[kind]}</span>
                            {" … "}
                            {ACCOUNT_KIND_HINT[kind]}
                        </li>
                    ))}
                </ul>

                {loading ? (
                    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" />
                        読み込み中…
                    </p>
                ) : rows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        口座がまだありません。「Zaimのマスタを更新」を押すと並びます
                    </p>
                ) : (
                    <ul className="divide-y">
                        {rows.map((row) => (
                            <AccountKindRow key={row.zaimAccountId} row={row} onChange={change} />
                        ))}
                    </ul>
                )}
            </CardContent>
        </Card>
    )
}

function AccountKindRow({
    row,
    onChange,
}: {
    row: ZaimAccountKindRow
    onChange: (row: ZaimAccountKindRow, kind: AccountKind) => void
}) {
    const id = `account-kind-${row.zaimAccountId}`
    return (
        <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 py-2">
            <label htmlFor={id} className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm font-medium">
                <span className="break-all">{row.name}</span>
                {row.kind !== "PENDING" && !row.kindManual && row.kind !== null && (
                    <Badge variant="secondary" className="text-[10px]">
                        推定
                    </Badge>
                )}
            </label>
            {row.kind === "PENDING" ? (
                <span className="text-xs text-muted-foreground">反映待ち（固定）</span>
            ) : (
                <Select
                    value={row.kind ?? undefined}
                    onValueChange={(next) => onChange(row, next as AccountKind)}
                >
                    <SelectTrigger id={id} size="sm" className="w-40">
                        <SelectValue placeholder="未設定（カード扱い）" />
                    </SelectTrigger>
                    <SelectContent>
                        {SELECTABLE_ACCOUNT_KINDS.map((kind) => (
                            <SelectItem key={kind} value={kind}>
                                {ACCOUNT_KIND_LABEL[kind]}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            )}
        </li>
    )
}
