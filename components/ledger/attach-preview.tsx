"use client"

import * as React from "react"
import { Loader2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { formatDate, formatYen } from "@/components/ledger/format"
import type { AttachField, AttachLine, AttachPlan, AttachSelection } from "@/lib/ledger-attach-preview"
import type { AttachPreviewView } from "@/lib/ledger-receipt-service"
import type { SubscriptionAttachPreviewView } from "@/lib/ledger-subscription-service"

const MAX_LINES = 4

function Lines({ lines }: { lines: AttachLine[] }) {
    const shown = lines.slice(0, MAX_LINES)
    return (
        <div className="flex flex-col gap-0.5">
            {shown.map((l, i) => (
                <div key={i} className="flex justify-between gap-2 tabular-nums">
                    <span className="min-w-0 truncate">{l.name || "（品名なし）"}</span>
                    <span className="shrink-0">{formatYen(l.amount)}</span>
                </div>
            ))}
            <span className="text-xs text-muted-foreground">{lines.length > MAX_LINES ? `ほか${lines.length - MAX_LINES}件・計${lines.length}件` : `${lines.length}件`}</span>
        </div>
    )
}

function Text({ value, empty }: { value: string | null; empty: string }) {
    return value ? <span className="break-words">{value}</span> : <span className="text-muted-foreground">{empty}</span>
}

/**
 * レシート・メールを付ける前の変更プレビュー（Issue #947）。項目（品目・店名・口座）ごとに変更前と変更後を並べ、
 * 「変更する／しない」を選んでから確定する。金額と日付は正であるカード明細のままで、選べない。
 */
/** 画面が読む変更プレビュー。レシート・メール（口座の行あり）とサブスク（口座の行なし）で共用する（Issue #957） */
export interface AttachPanelPreview {
    /** 欄の id を分けるための識別子 */
    key: string
    /** 見出し横のバッジの文言 */
    badge: string
    /** レシート・メールか、サブスクか。注記の文言が違う */
    source: "receipt" | "subscription"
    entryDate: string
    amount: number
    plan: Pick<AttachPlan, "lines" | "place"> & { account?: AttachPlan["account"] }
}

/** レシート・メールの変更プレビューを、画面の共通の形にする */
export function receiptPanelPreview(view: AttachPreviewView): AttachPanelPreview {
    return {
        key: `receipt-${view.receipt.id}`,
        badge: `${view.receipt.label}${view.receipt.storeName ? `・${view.receipt.storeName}` : ""}`,
        source: "receipt",
        entryDate: view.entryDate,
        amount: view.amount,
        plan: view.plan,
    }
}

/** サブスクの変更プレビューを、画面の共通の形にする（口座の行は無い） */
export function subscriptionPanelPreview(view: SubscriptionAttachPreviewView): AttachPanelPreview {
    return {
        key: `subscription-${view.subscription.id}`,
        badge: `サブスク・${view.subscription.name}`,
        source: "subscription",
        entryDate: view.entryDate,
        amount: view.amount,
        plan: view.plan,
    }
}

export function AttachPreviewPanel({
    preview,
    busy,
    onConfirm,
    onBack,
}: {
    preview: AttachPanelPreview
    busy: boolean
    onConfirm: (select: AttachSelection) => void
    onBack: () => void
}) {
    const { plan } = preview
    const isSubscription = preview.source === "subscription"
    const [select, setSelect] = React.useState<AttachSelection>({
        lines: plan.lines.changes && plan.lines.defaultOn,
        place: plan.place.changes && plan.place.defaultOn,
        account: plan.account != null && plan.account.changes && plan.account.defaultOn,
    })
    const count = (["lines", "place", "account"] as AttachField[]).filter((f) => select[f]).length
    const toggle = (field: AttachField) => (checked: boolean) => setSelect((prev) => ({ ...prev, [field]: checked }))
    const idBase = `attach-preview-${preview.key}`

    const row = (field: AttachField, title: string, before: React.ReactNode, after: React.ReactNode, notes: React.ReactNode, changes: boolean) => {
        const on = select[field]
        return (
            <div className="flex flex-col gap-2 border-t p-2.5 first:border-t-0">
                <div className="flex items-center justify-between gap-2">
                    <Label htmlFor={`${idBase}-${field}`} className="text-[13px] font-semibold">
                        {title}
                    </Label>
                    {changes ? (
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            {on ? "変更する" : "変更しない"}
                            <Switch id={`${idBase}-${field}`} checked={on} disabled={busy} onCheckedChange={toggle(field)} />
                        </span>
                    ) : (
                        <Badge variant="outline" className="text-[11px]">
                            変更なし
                        </Badge>
                    )}
                </div>
                <div className="grid grid-cols-1 gap-2 text-[13px] sm:grid-cols-2">
                    <div className={`min-w-0 rounded-md px-2.5 py-2 ${changes && on ? "bg-red-50 dark:bg-red-950/40" : "bg-muted"}`}>
                        <span className="block text-[10px] font-bold tracking-wider text-muted-foreground">変更前</span>
                        {before}
                    </div>
                    <div
                        className={`min-w-0 rounded-md px-2.5 py-2 ${changes && on ? "bg-emerald-50 dark:bg-emerald-950/40" : "bg-muted text-muted-foreground"} ${
                            changes && !on ? "line-through" : ""
                        }`}
                    >
                        <span className="block text-[10px] font-bold tracking-wider text-muted-foreground">変更後</span>
                        {after}
                    </div>
                </div>
                {notes}
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-2 rounded-xl border border-primary/40 p-3">
            <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">付けると変わる内容</span>
                <Badge variant="outline" className="max-w-[60%] truncate text-[11px]">
                    {preview.badge}
                </Badge>
            </div>
            <div className="overflow-hidden rounded-lg border">
                {row(
                    "lines",
                    "品目",
                    <Lines lines={plan.lines.before} />,
                    <Lines lines={plan.lines.after} />,
                    isSubscription ? (
                        <span className="text-xs text-muted-foreground">
                            {plan.lines.changes
                                ? "金額とカテゴリはそのままです。あとで紐付けを外しても、品目は元に戻りません。"
                                : "品目が複数ある取引、または名前がすでに同じ取引の品目は変えません。"}
                        </span>
                    ) : plan.lines.changes ? (
                        <span className="text-xs text-muted-foreground">外すと、品目はカード明細の内容に戻ります。</span>
                    ) : (
                        <span className="text-xs text-muted-foreground">メールは、品目が複数ある取引の品目を置き換えません。</span>
                    ),
                    plan.lines.changes
                )}
                {row(
                    "place",
                    "店名",
                    <Text value={plan.place.before} empty="（店名なし）" />,
                    <Text value={plan.place.after} empty="（変更なし）" />,
                    plan.place.changes ? (
                        <>
                            {plan.place.before != null && <span className="text-xs text-muted-foreground">すでに店名が入っているので、初期値は「変更しない」です。</span>}
                            {select.place && plan.place.before != null && (
                                <span className="rounded-md bg-amber-100 px-2 py-1 text-xs text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
                                    {isSubscription ? "「変更する」にすると、あとでサブスクの紐付けを外しても店名は元に戻りません。" : "「変更する」にすると、あとでレシートを外しても店名は元に戻りません。"}
                                </span>
                            )}
                        </>
                    ) : null,
                    plan.place.changes
                )}
                {plan.account &&
                    row(
                        "account",
                        "口座",
                        <Text value={plan.account.before} empty="口座未定" />,
                        <Text value={plan.account.after} empty="口座未定" />,
                        plan.account.changes ? null : <span className="text-xs text-muted-foreground">口座はいまのままです。</span>,
                        plan.account.changes
                    )}
            </div>
            <p className="text-xs text-muted-foreground">
                金額（{formatYen(preview.amount)}）と日付（{formatDate(preview.entryDate)}）は、この取引のままで変更できません。
            </p>
            <div className="flex flex-wrap items-center justify-end gap-2">
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onBack}>
                    戻る
                </Button>
                <Button type="button" size="sm" disabled={busy} onClick={() => onConfirm(select)}>
                    {busy && <Loader2 className="animate-spin" />}
                    {count > 0 ? `この内容で${isSubscription ? "紐付ける" : "付ける"}（${count}項目を変更）` : `変更せずに${isSubscription ? "紐付ける" : "付ける"}`}
                </Button>
            </div>
        </div>
    )
}
