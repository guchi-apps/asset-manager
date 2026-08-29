"use client"

/**
 * 内訳の提案タブ（Issue #271）。
 *
 * 「Zaimから読み込む」で内訳が決まっていない支出を集め、「反映」を押したぶんだけZaimへ書き戻す。
 * 読み込みでZaimを変更しないので、押す前にいくらでも見直せる。
 */

import * as React from "react"
import { Check, Loader2, RefreshCw, Sparkles, X } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { formatJstDate, formatYen } from "@/components/receipts/receipt-status"
import {
    applyGenreSuggestionsAction,
    dismissGenreSuggestionAction,
    getGenreSuggestionsAction,
    getZaimGenreChoicesAction,
    refreshGenreSuggestionsAction,
    updateGenreSuggestionAction,
    type GenreSuggestionRow,
    type ZaimGenreChoice,
} from "@/app/actions/kakeibo"

interface GenreSuggestionsProps {
    zaimConfigured: boolean
    onCountChange?: (count: number) => void
}

export function GenreSuggestions({ zaimConfigured, onCountChange }: GenreSuggestionsProps) {
    const [rows, setRows] = React.useState<GenreSuggestionRow[]>([])
    const [genres, setGenres] = React.useState<ZaimGenreChoice[]>([])
    const [selected, setSelected] = React.useState<Set<number>>(new Set())
    const [loading, setLoading] = React.useState(true)
    const [refreshing, setRefreshing] = React.useState(false)
    const [applying, setApplying] = React.useState(false)

    const notifyCount = React.useCallback(
        (next: GenreSuggestionRow[]) => onCountChange?.(next.length),
        [onCountChange]
    )

    const load = React.useCallback(async () => {
        const [suggestions, choices] = await Promise.all([
            getGenreSuggestionsAction(),
            getZaimGenreChoicesAction(),
        ])
        if (suggestions.success) {
            setRows(suggestions.data)
            notifyCount(suggestions.data)
            // 人が確認済みの分類（履歴・手で選んだもの）だけを最初からチェックしておく。
            setSelected(new Set(suggestions.data.filter((row) => row.preselected).map((row) => row.id)))
        }
        if (choices.success) setGenres(choices.data)
        setLoading(false)
    }, [notifyCount])

    React.useEffect(() => {
        void load()
    }, [load])

    const refresh = async () => {
        setRefreshing(true)
        try {
            const result = await refreshGenreSuggestionsAction()
            if (!result.success) {
                toast.error(result.error)
                return
            }
            const { undecided, byHistory, byAi, unresolved, aiUsed } = result.data
            if (undecided === 0) {
                toast.info("内訳が決まっていない支出はありませんでした")
            } else {
                toast.success(
                    `内訳が未設定の支出 ${undecided} 件（履歴 ${byHistory} 件・AI ${byAi} 件・判定できず ${unresolved} 件）`
                )
            }
            if (!aiUsed && undecided > 0) {
                toast.info("ANTHROPIC_API_KEY が未設定のため、分類履歴だけで提案しました")
            }
            await load()
        } finally {
            setRefreshing(false)
        }
    }

    const apply = async () => {
        const ids = rows.filter((row) => selected.has(row.id) && row.zaimGenreId !== null).map((row) => row.id)
        if (ids.length === 0) {
            toast.info("反映する提案を選んでください")
            return
        }

        setApplying(true)
        try {
            const result = await applyGenreSuggestionsAction(ids)
            if (!result.success) {
                toast.error(result.error)
                return
            }
            const { applied, failed, firstError } = result.data
            if (applied > 0) toast.success(applied + " 件の内訳をZaimへ反映しました")
            if (failed > 0) toast.error(failed + " 件の反映に失敗しました: " + (firstError ?? ""))
            await load()
        } finally {
            setApplying(false)
        }
    }

    const changeGenre = async (row: GenreSuggestionRow, zaimGenreId: number) => {
        const result = await updateGenreSuggestionAction(row.id, zaimGenreId)
        if (!result.success) {
            toast.error(result.error)
            return
        }
        // 手で選んだ内訳は反映してよいものなので、そのままチェックを入れる。
        setSelected((previous) => new Set(previous).add(row.id))
        await load()
    }

    const dismiss = async (row: GenreSuggestionRow) => {
        const result = await dismissGenreSuggestionAction(row.id)
        if (!result.success) {
            toast.error(result.error)
            return
        }
        toast.success("この明細は次から提案しません")
        await load()
    }

    const toggle = (id: number) => {
        setSelected((previous) => {
            const next = new Set(previous)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    const selectableIds = rows.filter((row) => row.zaimGenreId !== null).map((row) => row.id)
    const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id))
    const selectedCount = rows.filter((row) => selected.has(row.id) && row.zaimGenreId !== null).length

    const byHistory = rows.filter((row) => row.source !== "AI" && row.zaimGenreId !== null).length
    const byAi = rows.filter((row) => row.source === "AI" && row.zaimGenreId !== null).length
    const unresolved = rows.filter((row) => row.zaimGenreId === null).length

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing || !zaimConfigured}>
                    {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                    Zaimから読み込む
                </Button>
                <Badge variant="outline">直近60日</Badge>
                <div className="flex-1" />
                <Button
                    variant="ghost"
                    size="sm"
                    disabled={selectableIds.length === 0}
                    onClick={() =>
                        setSelected(allSelected ? new Set() : new Set(selectableIds))
                    }
                >
                    {allSelected ? "選択を解除" : "すべて選択"}
                </Button>
                <Button size="sm" onClick={apply} disabled={applying || selectedCount === 0}>
                    {applying ? <Loader2 className="animate-spin" /> : <Check />}
                    選んだ {selectedCount} 件をZaimへ反映
                </Button>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <SummaryTile label="内訳が未設定" value={rows.length} />
                <SummaryTile label="分類履歴で確定" value={byHistory} highlight />
                <SummaryTile label="AIの提案" value={byAi} />
                <SummaryTile label="判定できず" value={unresolved} />
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">内訳が決まっていない支出</CardTitle>
                    <CardDescription>
                        反映するのは内訳だけです。金額・日付・口座は変わりません。
                        分類履歴で決まった行には最初からチェックが入っています。
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                    {loading && (
                        <p className="py-8 text-center text-sm text-muted-foreground">読み込んでいます…</p>
                    )}

                    {!loading && rows.length === 0 && (
                        <p className="py-10 text-center text-sm text-muted-foreground">
                            <Sparkles className="mx-auto mb-3 size-8 opacity-40" />
                            {zaimConfigured
                                ? "「Zaimから読み込む」を押すと、内訳が決まっていない支出を集めます"
                                : "Zaim APIの設定が済むと使えます"}
                        </p>
                    )}

                    {rows.map((row) => (
                        <SuggestionRow
                            key={row.id}
                            row={row}
                            genres={genres}
                            checked={selected.has(row.id)}
                            onToggle={() => toggle(row.id)}
                            onChangeGenre={(zaimGenreId) => void changeGenre(row, zaimGenreId)}
                            onDismiss={() => void dismiss(row)}
                        />
                    ))}
                </CardContent>
            </Card>
        </div>
    )
}

function SummaryTile({
    label,
    value,
    highlight,
}: {
    label: string
    value: number
    highlight?: boolean
}) {
    return (
        <div className={"rounded-lg border p-3 " + (highlight && value > 0 ? "border-primary/40 bg-accent" : "")}>
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="mt-0.5 text-xl font-semibold tabular-nums">
                {value}
                <span className="ml-1 text-xs font-normal text-muted-foreground">件</span>
            </div>
        </div>
    )
}

function SuggestionRow({
    row,
    genres,
    checked,
    onToggle,
    onChangeGenre,
    onDismiss,
}: {
    row: GenreSuggestionRow
    genres: ZaimGenreChoice[]
    checked: boolean
    onToggle: () => void
    onChangeGenre: (zaimGenreId: number) => void
    onDismiss: () => void
}) {
    const label = row.name ?? row.place ?? "品目名なし"
    const decided = row.zaimGenreId !== null

    return (
        <div className="rounded-lg border p-3">
            <div className="flex items-start gap-3">
                <Checkbox
                    className="mt-0.5"
                    checked={checked}
                    disabled={!decided}
                    onCheckedChange={onToggle}
                    aria-label={label + " を反映する"}
                />
                <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{label}</div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {formatJstDate(row.date)}
                        {row.place && row.name ? "・" + row.place : ""}
                        {row.accountName ? "・" + row.accountName : ""}
                    </div>
                </div>
                <div className="shrink-0 text-right font-semibold tabular-nums">
                    {formatYen(row.amount)}
                </div>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
                <Select
                    value={row.zaimGenreId ? String(row.zaimGenreId) : undefined}
                    onValueChange={(value) => onChangeGenre(Number(value))}
                >
                    <SelectTrigger size="sm" className="w-full sm:w-64">
                        <SelectValue placeholder="内訳を選んでください" />
                    </SelectTrigger>
                    <SelectContent>
                        {genres.map((genre) => (
                            <SelectItem key={genre.zaimGenreId} value={String(genre.zaimGenreId)}>
                                {genre.categoryName} / {genre.genreName}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <SourceBadge source={row.source} confidence={row.confidence} decided={decided} />
                <span className="text-xs text-muted-foreground">{row.reason}</span>

                <div className="flex-1" />
                <Button variant="ghost" size="sm" onClick={onDismiss}>
                    <X />
                    今後提案しない
                </Button>
            </div>
        </div>
    )
}

function SourceBadge({
    source,
    confidence,
    decided,
}: {
    source: string
    confidence: number
    decided: boolean
}) {
    if (!decided) return <Badge variant="destructive">判定できず</Badge>
    if (source === "HISTORY") return <Badge variant="outline">履歴</Badge>
    if (source === "MANUAL") return <Badge variant="outline">手動</Badge>
    return <Badge variant="secondary">AI {confidence.toFixed(2)}</Badge>
}
