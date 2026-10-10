"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Check, ExternalLink, Loader2, RefreshCw, RotateCcw, Search } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
    dismissCardReconciliationAction,
    getCardReconciliationOverviewAction,
    restoreCardReconciliationAction,
    searchCardReceiptDetailsAction,
    selectReceiptCardMatchAction,
    type ReceiptOverview,
} from "@/app/actions/receipts"
import { ImportedReceiptList, ZaimCleanupList } from "@/components/receipts/import-cleanup"
import { formatYen, ReceiptStatusBadge } from "@/components/receipts/receipt-status"
import {
    type CardDetailPool,
    type CardReconciliationCard,
    type CardReconciliationOverview,
} from "@/lib/receipt-service"

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

/** 家計簿連携の主画面。カード明細の未対応・対応済み・対応不要を同じ場所で追えるようにする。 */
export function ReceiptsContent({ initialError }: ReceiptsContentProps) {
    const router = useRouter()
    const [overview, setOverview] = React.useState<CardReconciliationOverview | null>(null)
    const [loading, setLoading] = React.useState(true)
    const [searching, setSearching] = React.useState<number | null>(null)
    const [selecting, setSelecting] = React.useState<number | null>(null)
    const [changing, setChanging] = React.useState<number | null>(null)
    const [tab, setTab] = React.useState("unmatched")
    // この画面を開いてからの検索結果。未検索・取得失敗を「一致なし」と混同しないために持つ（#670）
    const [searchResult, setSearchResult] = React.useState<{ status: "ok" | "failed"; at: string; error?: string } | null>(null)

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
            const at = new Date().toISOString()
            if (!result.success) {
                setSearchResult({ status: "failed", at, error: result.error })
                return toast.error(result.error)
            }
            setSearchResult({ status: "ok", at })
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
    const dismiss = async (card: CardReconciliationCard) => {
        setChanging(card.moneyId)
        try {
            const result = await dismissCardReconciliationAction(card)
            if (!result.success) return toast.error(result.error)
            toast.success("対応不要として記録しました")
            await reload()
        } finally { setChanging(null) }
    }
    const restore = async (moneyId: number) => {
        setChanging(moneyId)
        try {
            const result = await restoreCardReconciliationAction(moneyId)
            if (!result.success) return toast.error(result.error)
            toast.success("未対応へ戻しました")
            await reload()
        } finally { setChanging(null) }
    }

    if (initialError) return <div className="p-4 text-sm text-destructive">{initialError}</div>
    // 再読み込み中は画面を差し替えない（差し替えるとスクロール位置とタブ選択が初期化される）
    if (overview === null) return <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 animate-spin" />カード明細を読み込んでいます…</div>
    if (!overview.available) return <div className="space-y-3 p-4"><Card><CardHeader><CardTitle className="text-lg">カード明細</CardTitle><CardDescription>{overview.reason ?? "カード明細を確認できませんでした"}</CardDescription></CardHeader><CardContent><Button variant="outline" onClick={() => void reload()} disabled={loading}>{loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}再読み込み</Button></CardContent></Card></div>

    return (
        <main className="mx-auto w-full min-w-0 max-w-5xl space-y-5 p-4 pb-12 sm:p-6">
            <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-bold tracking-tight">カード明細の対応</h1><p className="mt-1 text-sm text-muted-foreground">カード明細を起点に詳細明細を選び、置き換え準備を進めます。</p></div><Button variant="outline" size="sm" onClick={() => void reload()} disabled={loading}><RefreshCw />更新</Button></header>
            {overview.stale && <p className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">Zaim Web版の一覧が古くなっています。候補はZaimアプリでも確認してください。</p>}
            {overview.reason && <p className="rounded-md border px-3 py-2 text-sm text-muted-foreground">{overview.reason}。対応済み・対応しないの履歴は引き続き確認できます。</p>}
            <p className="text-xs text-muted-foreground">移行時の安全措置として、{day(overview.startsAfter)} 以前のカード明細は未対応一覧へ表示していません。</p>
            <Tabs value={tab} onValueChange={setTab} className="gap-4">
                <TabsList className="max-w-full justify-start overflow-x-auto"><TabsTrigger value="unmatched">未対応 <span className="tabular-nums opacity-70">{overview.cards.length}</span></TabsTrigger><TabsTrigger value="matched">対応済み <span className="tabular-nums opacity-70">{overview.matchedCards.length}</span></TabsTrigger><TabsTrigger value="dismissed">対応しない <span className="tabular-nums opacity-70">{overview.dismissedCards.length}</span></TabsTrigger><TabsTrigger value="imported">取り込み明細</TabsTrigger><TabsTrigger value="cleanup">Zaimと照合</TabsTrigger></TabsList>
                <TabsContent value="unmatched" className="space-y-4">
                    {overview.cards.length === 0 ? <EmptyCard>対応が必要な新しいカード明細はありません。</EmptyCard> : overview.cards.map((card) => <Card key={card.moneyId}><CardHeader className="grid-cols-1 gap-2 sm:flex-row sm:items-start sm:justify-between"><CardTitleBlock card={card} /><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => void search(card.moneyId)} disabled={searching !== null}>{searching === card.moneyId ? <Loader2 className="animate-spin" /> : <Search />}詳細明細を探す</Button><Button variant="outline" size="sm" onClick={() => void dismiss(card)} disabled={changing !== null}>{changing === card.moneyId ? <Loader2 className="animate-spin" /> : null}対応しない</Button></div></CardHeader><CardContent>{card.candidates.length === 0 ? <NoCandidateNotice pool={overview.detailPool} result={searchResult} searching={searching === card.moneyId} /> : <div className="space-y-2 border-t pt-4"><p className="text-sm font-medium">詳細明細候補</p>{card.candidates.map((candidate) => <div key={candidate.id} className="rounded-lg border p-3"><div className="flex flex-wrap items-baseline justify-between gap-2"><div className="min-w-0"><Badge variant="outline">{sourceLabel(candidate.source)}</Badge><span className="ml-2 break-words font-medium">{candidate.storeName ?? "店舗名なし"}</span></div><span className="font-semibold tabular-nums">{formatYen(candidate.totalAmount)}</span></div><p className="mt-1 break-words text-xs text-muted-foreground">{day(candidate.purchasedAt)} ・ {candidate.itemPreview.map((item) => item.name + " " + formatYen(item.amount)).join(" / ")}</p><Button className="mt-3" size="sm" onClick={() => void select(candidate.id, card)} disabled={selecting !== null}>{selecting === candidate.id ? <Loader2 className="animate-spin" /> : <Check />}この明細を使う</Button></div>)}</div>}</CardContent></Card>)}
                </TabsContent>
                <TabsContent value="matched" className="space-y-4">
                    {overview.matchedCards.length === 0 ? <EmptyCard>対応済みのカード明細はありません。</EmptyCard> : overview.matchedCards.map((card) => <Card key={card.moneyId}><CardHeader className="grid-cols-1"><CardTitleBlock card={card} /></CardHeader><CardContent className="space-y-3 border-t pt-4"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{sourceLabel(card.receipt.source)}</Badge><span className="min-w-0 break-words font-medium">{card.receipt.storeName ?? "店舗名なし"}</span><span className="font-semibold tabular-nums">{formatYen(card.receipt.totalAmount)}</span></div><p className="break-words text-sm text-muted-foreground">{day(card.receipt.purchasedAt)} ・ {card.receipt.itemPreview.map((item) => item.name + " " + formatYen(item.amount)).join(" / ") || "商品明細なし"}</p><div className="flex flex-wrap items-center gap-2"><Badge variant="secondary">状態: {card.receipt.progress}</Badge><ReceiptStatusBadge status={card.receipt.status} /></div><Button asChild variant="outline" size="sm"><Link href={'/receipts/' + card.receipt.id}>詳細を見る</Link></Button></CardContent></Card>)}
                </TabsContent>
                <TabsContent value="dismissed" className="space-y-4">
                    {overview.dismissedCards.length === 0 ? <EmptyCard>対応不要として記録したカード明細はありません。</EmptyCard> : overview.dismissedCards.map((card) => <Card key={card.moneyId}><CardHeader className="grid-cols-1 gap-2 sm:flex-row sm:items-start sm:justify-between"><CardTitleBlock card={card} /><Button variant="outline" size="sm" onClick={() => void restore(card.moneyId)} disabled={changing !== null}>{changing === card.moneyId ? <Loader2 className="animate-spin" /> : <RotateCcw />}未対応に戻す</Button></CardHeader><CardContent className="border-t pt-4"><Badge variant="secondary">対応しない</Badge></CardContent></Card>)}
                </TabsContent>
                <TabsContent value="imported"><ImportedReceiptList /></TabsContent>
                <TabsContent value="cleanup"><ZaimCleanupList /></TabsContent>
            </Tabs>
            <p className="text-xs text-muted-foreground">詳細明細を選択後、日付・金額・商品・カテゴリ／内訳を確認して反映待ち口座へ登録します。Zaimアプリで標準の「置き換え」を行ってください。</p>
            <Link className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline" href="/data-fetch"><ExternalLink className="size-3" />Zaim連携の設定を確認する</Link>
        </main>
    )
}

function dateTime(value: string): string {
    return new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

/** 候補が0件のときの説明。検索前・検索中・一致なし・取得失敗を区別する（#670）。 */
function NoCandidateNotice({ pool, result, searching }: { pool: CardDetailPool; result: { status: "ok" | "failed"; at: string; error?: string } | null; searching: boolean }) {
    const sources = pool.sources.length === 0
        ? "取り込み済みの詳細明細はまだありません"
        : pool.sources.map((s) => `${sourceLabel(s.source)} ${s.count}件（最新の取り込み ${dateTime(s.latestAt)}）`).join("、")
    let title: string
    let tone = "text-muted-foreground"
    if (searching) title = "詳細明細を探しています…"
    else if (result?.status === "failed") { title = "詳細明細を探せませんでした（一致なしとは限りません）"; tone = "text-destructive" }
    else if (result?.status === "ok") title = `${dateTime(result.at)}に探しましたが、対応する詳細明細（レシート・Amazon・メールなど）は見つかりませんでした`
    else title = "まだ詳細明細を探していません。「詳細明細を探す」で、対応するレシート・Amazon・メールなどを探せます"
    return (
        <div className="space-y-2 text-sm">
            <p className={tone}>{title}</p>
            {result?.status === "failed" && <p className="text-xs text-destructive">{result.error}</p>}
            <p className="text-xs text-muted-foreground">このカード明細は取得済みです。探しているのはカード明細自身ではなく、これに対応する詳細明細です。</p>
            <p className="break-words text-xs text-muted-foreground">探し先: {sources}。取り込みは直近{pool.lookbackDays}日分、候補はカード計上日の前後{pool.matchWindowDays}日・金額が一致（または近い）ものです。</p>
            {result?.status === "failed" && <Link className="inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline" href="/data-fetch"><ExternalLink className="size-3" />連携の設定を確認する</Link>}
            <p className="text-xs text-muted-foreground">詳細明細が本当に無いときだけ「対応しない」に記録できます（検索の失敗では自動で変更しません）。</p>
        </div>
    )
}

function CardTitleBlock({ card }: { card: CardReconciliationCard }) {
    return <div className="min-w-0"><Badge variant="secondary">{card.account}</Badge><CardTitle className="mt-2 break-words text-lg">{card.place ?? card.name ?? "店舗名なし"} <span className="ml-2 tabular-nums">{formatYen(card.amount)}</span></CardTitle><CardDescription>{day(card.date)} ・ Zaimカード連携明細</CardDescription></div>
}

function EmptyCard({ children }: { children: React.ReactNode }) {
    return <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">{children}</CardContent></Card>
}
