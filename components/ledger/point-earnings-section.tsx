"use client"

import * as React from "react"
import { Gift, Plus, RotateCcw, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { RowGroup } from "@/components/ledger/field-row"
import { formatLedgerPointBalance } from "@/lib/ledger-points"
import type { LedgerAccountView } from "@/lib/ledger-service"
import { cn } from "@/lib/utils"

/** 手入力のポイントカードの1行（#1583） */
export interface PointEarningDraft {
    key: number
    /** ポイント口座の id。未選択は "" */
    accountId: string
    /** 付いたポイント（整数の文字列）。空は「入れない」 */
    points: string
}

let pointKey = 0
export const newPointEarning = (partial: Partial<PointEarningDraft> = {}): PointEarningDraft => ({ key: ++pointKey, accountId: "", points: "", ...partial })

/** 入力中のポイントを整数に読む。読めなければ 0 */
export function readPoints(text: string): number {
    const value = Number(text.replace(/[,，\s]/g, ""))
    return Number.isInteger(value) ? value : 0
}

/**
 * 取引の入力画面の「ポイント還元」欄（#1583）。
 * - 自動計算の口座（PayPayポイントなど）で払ったときは、その口座の行を見込みつきで出し、実際のポイント数で上書きできる
 * - 「ポイントカードを追加」で、Zaimと連携していないポイント口座（Vポイントなど）を選び、付いたポイント数を入れる
 */
export function PointEarningsSection({
    auto,
    autoValue,
    onAutoChange,
    rows,
    onRowsChange,
    candidates,
    accountName,
}: {
    /** 自動計算の口座の行。払った口座が自動計算の元でなければ null */
    auto: { account: LedgerAccountView; estimate: number } | null
    /** 自動計算の行に入れたポイント数。空は自動計算のまま */
    autoValue: string
    onAutoChange: (value: string) => void
    rows: PointEarningDraft[]
    onRowsChange: (rows: PointEarningDraft[]) => void
    /** 手入力の行で選べるポイント口座 */
    candidates: LedgerAccountView[]
    accountName: (id: number) => string
}) {
    const total = (auto ? (autoValue.trim() === "" ? auto.estimate : readPoints(autoValue)) : 0) + rows.reduce((acc, r) => acc + readPoints(r.points), 0)
    const used = new Set(rows.map((r) => r.accountId))
    const unused = candidates.filter((a) => !used.has(String(a.id)))
    const autoBonus = auto && autoValue.trim() !== "" ? readPoints(autoValue) - auto.estimate : 0

    return (
        <RowGroup>
            <div className="flex items-center gap-3 px-4 pt-2.5 pb-1 sm:px-3.5">
                <Gift className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="text-sm font-medium">ポイント還元</span>
                {(auto || rows.length > 0) && (
                    <span className="ml-auto text-sm font-medium tabular-nums text-emerald-700 dark:text-emerald-400" aria-live="polite">
                        合計 +{formatLedgerPointBalance(total)}
                    </span>
                )}
            </div>
            {auto && (
                <div className="flex flex-col gap-1 px-4 py-2 sm:px-3.5">
                    <div className="flex items-center gap-2 pl-8">
                        <span className="min-w-0 flex-1 truncate text-sm">{auto.account.name}</span>
                        <Input
                            id="ledger-point-auto"
                            aria-label={`${auto.account.name}で付いたポイント`}
                            inputMode="numeric"
                            placeholder={String(auto.estimate)}
                            value={autoValue}
                            onChange={(e) => onAutoChange(e.target.value)}
                            className="h-9 w-24 bg-background text-right tabular-nums"
                        />
                        <span className="w-5 text-xs text-muted-foreground">pt</span>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            aria-label="自動計算に戻す"
                            disabled={autoValue.trim() === ""}
                            onClick={() => onAutoChange("")}
                        >
                            <RotateCcw />
                        </Button>
                    </div>
                    <p className="pl-8 text-xs text-muted-foreground">
                        {autoValue.trim() === ""
                            ? `自動計算 ${auto.estimate.toLocaleString("ja-JP")} pt（${auto.account.pointRateBp / 100}%）。キャンペーンなどで実際の付与が違うときは、ポイント数を入れます。`
                            : autoBonus > 0
                              ? `自動計算は ${auto.estimate.toLocaleString("ja-JP")} pt。超えた ${autoBonus.toLocaleString("ja-JP")} pt はボーナスとして、支払いの${auto.account.pointBonusLagDays}日後に付与される前提で数えます。`
                              : `自動計算は ${auto.estimate.toLocaleString("ja-JP")} pt。入れたポイント数で数えます。`}
                    </p>
                </div>
            )}
            {rows.map((row, index) => {
                const options = candidates.filter((a) => String(a.id) === row.accountId || !used.has(String(a.id)))
                return (
                    <div key={row.key} className="flex items-center gap-2 px-4 py-2 pl-12 sm:px-3.5 sm:pl-11">
                        <Select value={row.accountId} onValueChange={(v) => onRowsChange(rows.map((r) => (r.key === row.key ? { ...r, accountId: v } : r)))}>
                            <SelectTrigger aria-label={`ポイントカードの${index + 1}行目`} className={cn("h-9 min-w-0 flex-1", row.accountId === "" && "text-muted-foreground")}>
                                <SelectValue placeholder="ポイントカードを選ぶ">{row.accountId !== "" ? accountName(Number(row.accountId)) : undefined}</SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                                {options.map((a) => (
                                    <SelectItem key={a.id} value={String(a.id)}>
                                        {a.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Input
                            aria-label={`ポイントカードの${index + 1}行目で付いたポイント`}
                            inputMode="numeric"
                            placeholder="0"
                            value={row.points}
                            onChange={(e) => onRowsChange(rows.map((r) => (r.key === row.key ? { ...r, points: e.target.value } : r)))}
                            className="h-9 w-24 bg-background text-right tabular-nums"
                        />
                        <span className="w-5 text-xs text-muted-foreground">pt</span>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            aria-label={`ポイントカードの${index + 1}行目を削除`}
                            onClick={() => onRowsChange(rows.filter((r) => r.key !== row.key))}
                        >
                            <Trash2 />
                        </Button>
                    </div>
                )
            })}
            <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/50 px-4 py-1.5 sm:px-3.5">
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="-ml-2 text-primary"
                    disabled={unused.length === 0}
                    onClick={() => onRowsChange([...rows, newPointEarning({ accountId: unused.length === 1 ? String(unused[0].id) : "" })])}
                >
                    <Plus />
                    ポイントカードを追加
                </Button>
                <span className="text-xs text-muted-foreground">
                    {candidates.length === 0 ? "種類「ポイント」の口座を作ると選べます" : "Vポイント・楽天ポイントなど"}
                </span>
            </div>
        </RowGroup>
    )
}
