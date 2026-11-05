"use client"

import * as React from "react"
import { Loader2, Wand2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
    createAccountsForUnmappedAction,
    setAccountMappingAction,
    setDefaultCardAccountAction,
    setCategoryMappingAction,
    type LedgerActionResult,
} from "@/app/actions/ledger"
import type { LedgerAccountView, LedgerCategoryView } from "@/lib/ledger-service"
import type { MappingOverview } from "@/lib/ledger-sources/mapping-service"
import { sourceCategoryLabel } from "@/lib/ledger-sources/mapping"

const UNSET = "unset"
const INFO = "info"

function useRunner(onChanged: () => void) {
    const [busy, setBusy] = React.useState<string | null>(null)
    const run = async (key: string, action: () => Promise<LedgerActionResult>, success?: string) => {
        setBusy(key)
        try {
            const result = await action()
            if (!result.success) {
                toast.error(result.error)
                return
            }
            if (success) toast.success(success)
            onChanged()
        } finally {
            setBusy(null)
        }
    }
    return { busy, run }
}

/**
 * 取り込み元（Zaim）の口座名・カテゴリ名と、家計簿の口座・カテゴリの対応（Issue #816）。
 * 対応を変えると、取り込み済みの取引・品目にもすぐ適用する（手で選んだ口座・カテゴリは変えない）。
 */
export function MappingSettings({
    mapping,
    accounts,
    categories,
    onChanged,
}: {
    mapping: MappingOverview
    accounts: LedgerAccountView[]
    categories: LedgerCategoryView[]
    onChanged: () => void
}) {
    const { busy, run } = useRunner(onChanged)
    const unmappedNames = mapping.accounts.filter((a) => a.target === null)
    const unmappedCategoryCount = mapping.categories.filter((c) => c.resolvedCategoryId === null).length

    const categoryOptions = React.useMemo(() => {
        const options: { id: number; label: string; kind: string }[] = []
        for (const top of categories.filter((c) => c.parentId === null && !c.hidden)) {
            options.push({ id: top.id, label: top.name, kind: top.kind })
            for (const child of categories.filter((c) => c.parentId === top.id && !c.hidden)) {
                options.push({ id: child.id, label: `${top.name} / ${child.name}`, kind: child.kind })
            }
        }
        return options
    }, [categories])

    return (
        <div className="flex flex-col gap-4">
            <Card>
                <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex flex-col gap-1">
                        <CardTitle>口座名の対応</CardTitle>
                        <CardDescription>
                            Zaimの口座名を、家計簿の口座へ対応付けます。スマートレシート・Amazonのような連携サービスは「情報源」にすると取引にしません（支払いはカード明細で数えます）。
                        </CardDescription>
                    </div>
                    {unmappedNames.length > 0 && (
                        <Button
                            size="sm"
                            disabled={busy !== null}
                            onClick={() =>
                                run(
                                    "bulk",
                                    () =>
                                        createAccountsForUnmappedAction(
                                            "zaim",
                                            unmappedNames.map((a) => a.externalName)
                                        ),
                                    "未対応の口座名から口座を作りました"
                                )
                            }
                        >
                            {busy === "bulk" ? <Loader2 className="animate-spin" /> : <Wand2 />}
                            未対応の{unmappedNames.length}件から口座を作る
                        </Button>
                    )}
                </CardHeader>
                <CardContent className="flex flex-col">
                    {mapping.accounts.length === 0 && (
                        <p className="py-2 text-sm text-muted-foreground">
                            Zaimから取り込んだ明細がまだありません。取り込むと、ここに口座名が並びます。
                        </p>
                    )}
                    {mapping.accounts.map((row) => {
                        const value = row.target === "INFO_SOURCE" ? INFO : row.accountId != null ? String(row.accountId) : UNSET
                        const key = `a:${row.externalName}`
                        return (
                            <div key={key} className="flex flex-wrap items-center gap-2 border-b py-2 last:border-b-0 max-sm:[&>div:first-child]:basis-full">
                                <div className="flex min-w-0 flex-1 flex-col">
                                    <span className="truncate text-sm">{row.externalName}</span>
                                    <span className="text-xs text-muted-foreground">取引 {row.entryCount}件</span>
                                </div>
                                {row.target === null && <Badge variant="outline" className="text-amber-700 dark:text-amber-400">未対応</Badge>}
                                <Select
                                    value={value}
                                    disabled={busy !== null}
                                    onValueChange={(v) => run(key, () => setAccountMappingAction("zaim", row.externalName, v))}
                                >
                                    <SelectTrigger size="sm" className="w-48" aria-label={`${row.externalName} の対応先`}>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value={UNSET}>未対応</SelectItem>
                                        <SelectItem value={INFO}>情報源（取引にしない）</SelectItem>
                                        <SelectSeparator />
                                        {accounts.map((a) => (
                                            <SelectItem key={a.id} value={String(a.id)}>
                                                {a.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )
                    })}
                </CardContent>
            </Card>

            <DefaultCardSetting
                value={mapping.defaultCardAccountId}
                cards={accounts.filter((a) => a.kind === "CARD")}
                busy={busy}
                onChange={(v) => run("defaultCard", () => setDefaultCardAccountAction(v), "既定のカードを保存しました")}
            />

            <Card>
                <CardHeader>
                    <CardTitle>カテゴリ名の対応</CardTitle>
                    <CardDescription>
                        Zaimのカテゴリ・内訳を、家計簿のカテゴリへ対応付けます。内訳ごとの対応が無ければ、同じカテゴリの「内訳を問わない」対応を使います。手で分類した品目は変えません。
                        {unmappedCategoryCount > 0 && ` 未対応 ${unmappedCategoryCount}件。`}
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col">
                    {mapping.categories.length === 0 && (
                        <p className="py-2 text-sm text-muted-foreground">取り込んだ品目にZaimの分類名がまだありません。</p>
                    )}
                    {mapping.categories.map((row) => {
                        const key = `c:${row.externalCategory}\u0000${row.externalGenre}`
                        const inherited = row.categoryId === null && row.resolvedCategoryId !== null
                        return (
                            <div key={key} className="flex flex-wrap items-center gap-2 border-b py-2 last:border-b-0 max-sm:[&>div:first-child]:basis-full">
                                <div className="flex min-w-0 flex-1 flex-col">
                                    <span className="truncate text-sm">
                                        {sourceCategoryLabel(row.externalCategory, row.externalGenre || null)}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                        品目 {row.lineCount}件{inherited ? "・カテゴリだけの対応を使用中" : ""}
                                    </span>
                                </div>
                                {row.resolvedCategoryId === null && (
                                    <Badge variant="outline" className="text-amber-700 dark:text-amber-400">未対応</Badge>
                                )}
                                <Select
                                    value={row.categoryId != null ? String(row.categoryId) : UNSET}
                                    disabled={busy !== null}
                                    onValueChange={(v) =>
                                        run(key, () => setCategoryMappingAction("zaim", row.externalCategory, row.externalGenre, v))
                                    }
                                >
                                    <SelectTrigger size="sm" className="w-48" aria-label={`${row.externalCategory} の対応先`}>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value={UNSET}>{inherited ? "カテゴリだけの対応に従う" : "未対応"}</SelectItem>
                                        {categoryOptions.map((o) => (
                                            <SelectItem key={o.id} value={String(o.id)}>
                                                {o.label}
                                                {o.kind === "INCOME" ? "（収入）" : ""}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {row.externalGenre !== "" && !mapping.categories.some((c) => c.externalCategory === row.externalCategory && c.externalGenre === "") && (
                                    <CategoryOnlyButton
                                        disabled={busy !== null || row.resolvedCategoryId === null}
                                        onClick={() =>
                                            run(
                                                `${key}:all`,
                                                () =>
                                                    setCategoryMappingAction(
                                                        "zaim",
                                                        row.externalCategory,
                                                        "",
                                                        String(row.resolvedCategoryId)
                                                    ),
                                                `「${row.externalCategory}」の他の内訳にも同じカテゴリを使います`
                                            )
                                        }
                                    />
                                )}
                            </div>
                        )
                    })}
                </CardContent>
            </Card>
        </div>
    )
}

function CategoryOnlyButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
    return (
        <Button variant="ghost" size="sm" disabled={disabled} onClick={onClick} title="同じカテゴリの他の内訳にも、この対応先を使う">
            他の内訳にも
        </Button>
    )
}

/**
 * メール・外部アプリの明細（Gmail・car-care）を家計簿へ登録する既定のカード（Issue #843）。
 * 明細の支払方法から口座を決められなかったときに使う。以前は環境変数 `ZAIM_CARD_ACCOUNT_ID` で決めていた。
 */
function DefaultCardSetting({
    value,
    cards,
    busy,
    onChange,
}: {
    value: number | null
    /** 表示中のカードの口座 */
    cards: LedgerAccountView[]
    busy: string | null
    onChange: (value: string) => void
}) {
    const selected = value != null ? String(value) : UNSET
    // 非表示にした・種類を変えた口座が設定されたままなら、その状態が分かるように選択肢へ残す
    const missing = value != null && !cards.some((a) => a.id === value)
    return (
        <Card>
            <CardHeader>
                <CardTitle>既定のカード</CardTitle>
                <CardDescription>
                    メール・外部アプリの明細を登録する既定のカードです。明細の支払方法から口座を決められなかったときに使います。未設定なら、レシート画面で口座を選んで登録します。
                </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-2 max-sm:[&>span]:basis-full">
                <span className="min-w-0 flex-1 text-sm">メール・外部アプリの明細を登録する既定のカード</span>
                <Select value={selected} disabled={busy !== null} onValueChange={onChange}>
                    <SelectTrigger size="sm" className="w-48" aria-label="メール・外部アプリの明細を登録する既定のカード">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={UNSET}>未設定</SelectItem>
                        {(cards.length > 0 || missing) && <SelectSeparator />}
                        {missing && <SelectItem value={String(value)}>（非表示・カード以外の口座）</SelectItem>}
                        {cards.map((a) => (
                            <SelectItem key={a.id} value={String(a.id)}>
                                {a.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {cards.length === 0 && (
                    <p className="basis-full text-xs text-muted-foreground">
                        種類が「カード」の口座がありません。「口座」タブでカードの口座を作ると選べます。
                    </p>
                )}
            </CardContent>
        </Card>
    )
}
