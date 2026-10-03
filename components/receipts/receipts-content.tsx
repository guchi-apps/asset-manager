"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Check, ExternalLink, Loader2, RefreshCw, Search } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
    getCardReconciliationOverviewAction,
    searchCardReceiptDetailsAction,
    selectReceiptCardMatchAction,
    type ReceiptOverview,
} from "@/app/actions/receipts"
import { formatYen } from "@/components/receipts/receipt-status"
import type { CardReconciliationCard, CardReconciliationOverview } from "@/lib/receipt-service"

interface ReceiptsContentProps {
    initialData: ReceiptOverview | null
    initialError: string | null
}

function sourceLabel(source: string): string {
    return { GMAIL: "Gmail", EXTERNAL_APP: "外部アプリ", SMART_RECEIPT: "スマートレシート", AMAZON: "Amazon", PHOTO: "レシート" }[source] ?? source
}

function day(value: string | null): string {
    return value?.replaceAll("-", "/") ?? "—"
}

/** 家計簿連携の主画面。Zaimのカード連携明細から作業を始める。 */
export function ReceiptsContent({ initialError }: ReceiptsContentProps) {
    const router = useRouter()
    const [overview, setOverview] = React.useState<CardReconciliationOverview | null>(null)
    const [loading, setLoading] = React.useState(true)
    const [searching, setSearching] = React.useState<number | null>(null)
    const [selecting, setSelecting] = React.useState<number | null>(null)

    const reload = React.useCallback(async () => {
        setLoading(true)
        try {
            const result = await getCardReconciliationOverviewAction()
            if (!result.success) return toast.error(result.error)
            setOverview(result.data)
        } finally { setLoading(false) }
    }, [])
    React.useEffect(() => { void reload() }, [reload])

    const search = async (moneyId: number) => {
        setSearching(moneyId)
        try {
            const result = await searchCardReceiptDetailsAction()
            if (!result.success) return toast.error(result.error)
            await reload()
        } finally { setSearching(null) }
    }
    const select = async (receiptId: number, card: CardReconciliationCard) => {
        setSelecting(receiptId)
        try {
            const result = await selectReceiptCardMatchAction(receiptId, card)
            if (!result.success) return toast.error(result.error)
            toast.success("カード明細との対応を保存しました。内容を確認して置き換え準備を進めてください")
            router.push("/receipts/" + receiptId)
        } finally { setSelecting(null) }
    }

    if (initialError) return <div className="p-4 text-sm text-destructive">{initialError}</div>
    if (loading || overview === null) return <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 animate-spin" />カード明細を読み込んでいます…</div>
    if (!overview.available) return <div className="space-y-3 p-4"><Card><CardHeader><CardTitle className="text-lg">未対応のカード明細</CardTitle><CardDescription>{overview.reason ?? "カード明細を確認できませんでした"}</CardDescription></CardHeader><CardContent><Button variant="outline" onClick={() => void reload()}><RefreshCw />再読み込み</Button></CardContent></Card></div>

    return (
        <main className="mx-auto max-w-5xl space-y-5 p-4 pb-12 sm:p-6">
            <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-bold tracking-tight">未対応のカード明細</h1><p className="mt-1 text-sm text-muted-foreground">カード明細を起点に詳細明細を選び、置き換え準備を進めます。</p></div><Button variant="outline" size="sm" onClick={() => void reload()} disabled={loading}><RefreshCw />更新</Button></header>
            {overview.stale && <p className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">Zaim Web版の一覧が古くなっています。候補はZaimアプリでも確認してください。</p>}
            <p className="text-xs text-muted-foreground">移行時の安全措置として、{day(overview.startsAfter)} 以前のカード明細は表示していません。</p>
            {overview.cards.length === 0 ? <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">対応が必要な新しいカード明細はありません。</CardContent></Card> : <div className="space-y-4">
                {overview.cards.map((card) => <Card key={card.moneyId}><CardHeader className="gap-2 sm:flex-row sm:items-start sm:justify-between"><div><Badge variant="secondary">{card.account}</Badge><CardTitle className="mt-2 text-lg">{card.place ?? card.name ?? "店舗名なし"} <span className="ml-2 tabular-nums">{formatYen(card.amount)}</span></CardTitle><CardDescription>{day(card.date)} ・ Zaimカード連携明細</CardDescription></div><Button variant="outline" size="sm" onClick={() => void search(card.moneyId)} disabled={searching !== null}>{searching === card.moneyId ? <Loader2 className="animate-spin" /> : <Search />}詳細明細を探す</Button></CardHeader><CardContent>{card.candidates.length === 0 ? <p className="text-sm text-muted-foreground">候補はありません。何も変更せず、この明細は後で再確認できます。</p> : <div className="space-y-2 border-t pt-4"><p className="text-sm font-medium">詳細明細候補</p>{card.candidates.map((candidate) => <div key={candidate.id} className="rounded-lg border p-3"><div className="flex flex-wrap items-baseline justify-between gap-2"><div><Badge variant="outline">{sourceLabel(candidate.source)}</Badge><span className="ml-2 font-medium">{candidate.storeName ?? "店舗名なし"}</span></div><span className="font-semibold tabular-nums">{formatYen(candidate.totalAmount)}</span></div><p className="mt-1 text-xs text-muted-foreground">{day(candidate.purchasedAt)} ・ {candidate.itemPreview.map((item) => item.name + " " + formatYen(item.amount)).join(" / ")}</p><Button className="mt-3" size="sm" onClick={() => void select(candidate.id, card)} disabled={selecting !== null}>{selecting === candidate.id ? <Loader2 className="animate-spin" /> : <Check />}この明細を使う</Button></div>)}</div>}</CardContent></Card>)}
            </div>}
            <p className="text-xs text-muted-foreground">詳細明細を選択後、日付・金額・商品・カテゴリ／内訳を確認して反映待ち口座へ登録します。Zaimアプリで標準の「置き換え」を行ってください。</p>
            <Link className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline" href="/data-fetch"><ExternalLink className="size-3" />Zaim連携の設定を確認する</Link>
        </main>
    )
}
