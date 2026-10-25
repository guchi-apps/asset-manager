"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Check, ChevronRight, ExternalLink, EyeOff, Loader2, RefreshCw, RotateCcw, Search } from "lucide-react"
import { toast } from "sonner"

import { UnmatchControl } from "@/components/receipts/unmatch-control"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
    dismissCardReconciliationAction,
    getCardReconciliationOverviewAction,
    restoreCardReconciliationAction,
    restoreSetAsideReceiptAction,
    searchCardReceiptDetailsAction,
    selectReceiptCardMatchAction,
    setAsideReceiptAction,
    type ReceiptOverview,
} from "@/app/actions/receipts"
import { ImportedReceiptList, ZaimCleanupList } from "@/components/receipts/import-cleanup"
import { formatYen, ReceiptStatusBadge } from "@/components/receipts/receipt-status"
import {
    type CardReconciliationCandidate,
    type CardReconciliationCard,
    type CardReconciliationOverview,
    type SetAsideReceipt,
} from "@/lib/receipt-service"
import {
    describeCardTriage,
    describeReceiptTriage,
    TRIAGE_WAIT_DAYS,
    type TriageBucket,
} from "@/lib/receipt-triage"

interface ReceiptsContentProps {
    initialData: ReceiptOverview | null
    initialError: string | null
}

type TriagedCard = CardReconciliationOverview["cards"][number]
type LooseReceipt = CardReconciliationOverview["looseReceipts"][number]

function sourceLabel(source: string): string {
    return { GMAIL: "Gmail", EXTERNAL_APP: "外部アプリ", SMART_RECEIPT: "スマートレシート", AMAZON: "Amazon", PHOTO: "レシート" }[source] ?? source
}

function day(value: string | null): string {
    return value?.replaceAll("-", "/") ?? "—"
}

function dateTime(value: string): string {
    return new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

const BUCKET_STYLE: Record<TriageBucket, string> = {
    action: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    decide: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
    rest: "bg-muted text-muted-foreground",
}

function ReasonBadge({ bucket, label }: { bucket: TriageBucket; label: string }) {
    return <Badge className={BUCKET_STYLE[bucket]}>{label}</Badge>
}

/** カード明細が届く前でも、Zaimへ置き換えるまでの流れを1か所で追う家計簿連携の主画面（#768）。 */
export function ReceiptsContent({ initialError }: ReceiptsContentProps) {
    const router = useRouter()
    const [overview, setOverview] = React.useState<CardReconciliationOverview | null>(null)
    const [loading, setLoading] = React.useState(true)
    const [searching, setSearching] = React.useState(false)
    const [busy, setBusy] = React.useState<string | null>(null)
    const [tab, setTab] = React.useState("matched")

    const reload = React.useCallback(async () => {
        setLoading(true)
        try {
            const result = await getCardReconciliationOverviewAction()
            if (!result.success) return toast.error(result.error)
            setOverview(result.data)
        } finally { setLoading(false) }
    }, [])
    React.useEffect(() => { void reload() }, [reload])

    // 検索の成否はサーバーに記録され、読み直した一覧の区分に反映される（未探索・失敗を「候補なし」と混同しない。#670・#768）
    const search = async () => {
        setSearching(true)
        try {
            const result = await searchCardReceiptDetailsAction()
            if (!result.success) toast.error(result.error)
            await reload()
        } finally { setSearching(false) }
    }
    const run = async (key: string, action: () => Promise<{ success: true } | { success: false; error: string }>, message: string) => {
        setBusy(key)
        try {
            const result = await action()
            if (!result.success) return toast.error(result.error)
            toast.success(message)
            await reload()
        } finally { setBusy(null) }
    }
    const select = async (receiptId: number, card: CardReconciliationCard, samePaymentIds: number[]) => {
        setBusy("select:" + receiptId)
        try {
            const result = await selectReceiptCardMatchAction(receiptId, card, samePaymentIds.filter((id) => id !== receiptId))
            if (!result.success) return toast.error(result.error)
            toast.success("カード明細との対応を保存しました。内容を確認して置き換え準備を進めてください")
            router.push("/receipts/" + receiptId)
        } finally { setBusy(null) }
    }
    const handlers: Handlers = {
        busy,
        searching,
        search: () => void search(),
        select: (receiptId, card, samePaymentIds) => void select(receiptId, card, samePaymentIds),
        dismiss: (card) => void run("card:" + card.moneyId, () => dismissCardReconciliationAction(cardOf(card)), "対応しないに記録しました。「履歴・整理」から戻せます"),
        setAside: (id) => void run("receipt:" + id, () => setAsideReceiptAction(id), "使わないにしました。「履歴・整理」から戻せます"),
        restoreReceipt: (id) => void run("receipt:" + id, () => restoreSetAsideReceiptAction(id), "作業一覧へ戻しました"),
        restoreCard: (moneyId) => void run("card:" + moneyId, () => restoreCardReconciliationAction(moneyId), "未対応へ戻しました"),
    }

    if (initialError) return <div className="p-4 text-sm text-destructive">{initialError}</div>
    // 再読み込み中は画面を差し替えない（差し替えるとスクロール位置とタブ選択が初期化される）
    if (overview === null) return <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 animate-spin" />カード明細を読み込んでいます…</div>
    if (!overview.available) return <div className="space-y-3 p-4"><Card><CardHeader><CardTitle className="text-lg">カード明細</CardTitle><CardDescription>{overview.reason ?? "カード明細を確認できませんでした"}</CardDescription></CardHeader><CardContent><Button variant="outline" onClick={() => void reload()} disabled={loading}>{loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}再読み込み</Button></CardContent></Card></div>

    const cardsIn = (bucket: TriageBucket) => overview.cards.filter((card) => card.triage.bucket === bucket)
    const looseIn = (bucket: TriageBucket) => overview.looseReceipts.filter((receipt) => receipt.triage.bucket === bucket)
    const recentSamePayment = overview.setAsideReceipts.filter((row) =>
        row.reason === "SAME_PAYMENT" && Date.now() - Date.parse(row.setAsideAt) <= TRIAGE_WAIT_DAYS * 86_400_000)
    const action = cardsIn("action")
    const decideCards = cardsIn("decide")
    const decideLoose = looseIn("decide")
    const restCards = cardsIn("rest")
    const restLoose = looseIn("rest")
    const decideCount = decideCards.length + decideLoose.length
    const restCount = restCards.length + restLoose.length + recentSamePayment.length
    const restBreakdown = countLabels([
        ...restCards.map((card) => describeCardTriage(card.triage.reason, triageDetail(card, overview)).label),
        ...restLoose.map((receipt) => describeReceiptTriage(receipt.triage.reason).label),
        ...recentSamePayment.map(() => "同じ支払いは対応済み"),
    ])

    return (
        <main className="mx-auto w-full min-w-0 max-w-5xl space-y-5 p-4 pb-12 sm:p-6">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div><h1 className="text-2xl font-bold tracking-tight">カード明細の対応</h1><p className="mt-1 text-sm text-muted-foreground">人の判断が要るものだけを上に出します。</p></div>
                <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => void search()} disabled={searching || busy !== null}>{searching ? <Loader2 className="animate-spin" /> : <Search />}詳細明細を探す</Button>
                    <Button variant="outline" size="sm" onClick={() => void reload()} disabled={loading}><RefreshCw />更新</Button>
                </div>
            </header>
            <SourceStatus overview={overview} />
            {overview.stale && <p className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">Zaim Web版の一覧が古くなっています。新しいカード明細がまだ出ていないことがあります。</p>}
            {overview.reason && <p className="rounded-md border px-3 py-2 text-sm text-muted-foreground">{overview.reason}。対応済み・対応しないの履歴は引き続き確認できます。</p>}

            <div className="grid grid-cols-3 gap-2 sm:gap-3">
                <SummaryTile bucket="action" title="要対応" count={action.length} note="確認して選ぶだけ" />
                <SummaryTile bucket="decide" title="要判断" count={decideCount} note="重複・同額・取得不足など" />
                <SummaryTile bucket="rest" title="今は作業不要" count={restCount} note="到着待ち・対応済みの別明細" />
            </div>

            <section className="space-y-3">
                <SectionTitle bucket="action" label="要対応" title="確認して選ぶ" count={action.length} />
                {action.length === 0 ? <EmptyNote>確認して選ぶだけのカード明細はありません。</EmptyNote> : action.map((card) => <CardItem key={card.moneyId} card={card} overview={overview} handlers={handlers} />)}
            </section>

            <section className="space-y-3">
                <SectionTitle bucket="decide" label="要判断" title="人が決める" count={decideCount} />
                {decideCount === 0 ? <EmptyNote>判断が必要なものはありません。</EmptyNote> : <>
                    {decideCards.map((card) => <CardItem key={card.moneyId} card={card} overview={overview} handlers={handlers} />)}
                    {decideLoose.map((receipt) => <LooseItem key={receipt.id} receipt={receipt} handlers={handlers} />)}
                </>}
            </section>

            <details className="group rounded-lg border bg-card">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                    <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
                    今は作業不要 <span className="tabular-nums text-xs font-normal text-muted-foreground">{restCount}件</span>
                    {restBreakdown && <span className="text-xs font-normal text-muted-foreground">{restBreakdown}</span>}
                </summary>
                <div className="divide-y border-t">
                    {restCount === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">ありません。</p>}
                    {restCards.map((card) => <RestCardRow key={card.moneyId} card={card} overview={overview} handlers={handlers} />)}
                    {restLoose.map((receipt) => <RestReceiptRow key={receipt.id} receipt={receipt} handlers={handlers} />)}
                    {recentSamePayment.map((row) => <SetAsideRow key={row.id} row={row} handlers={handlers} compact />)}
                </div>
            </details>

            <section className="space-y-3">
                <h2 className="text-base font-semibold">履歴・整理</h2>
                <Tabs value={tab} onValueChange={setTab} className="gap-4">
                    <TabsList className="max-w-full justify-start overflow-x-auto"><TabsTrigger value="matched">対応済み <span className="tabular-nums opacity-70">{overview.matchedCards.length}</span></TabsTrigger><TabsTrigger value="dismissed">対応しない <span className="tabular-nums opacity-70">{overview.dismissedCards.length}</span></TabsTrigger><TabsTrigger value="setAside">使わない明細 <span className="tabular-nums opacity-70">{overview.setAsideReceipts.length}</span></TabsTrigger><TabsTrigger value="imported">取り込み明細</TabsTrigger><TabsTrigger value="cleanup">Zaimと照合</TabsTrigger></TabsList>
                    <TabsContent value="matched" className="space-y-4">
                        {overview.matchedCards.length === 0 ? <EmptyCard>対応済みのカード明細はありません。</EmptyCard> : overview.matchedCards.map((card) => <Card key={card.moneyId}><CardHeader className="grid-cols-1"><CardTitleBlock card={card} /></CardHeader><CardContent className="space-y-3 border-t pt-4"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{sourceLabel(card.receipt.source)}</Badge><span className="min-w-0 break-words font-medium">{card.receipt.storeName ?? "店舗名なし"}</span><span className="font-semibold tabular-nums">{formatYen(card.receipt.totalAmount)}</span></div><p className="break-words text-sm text-muted-foreground">{day(card.receipt.purchasedAt)} ・ {card.receipt.itemPreview.map((item) => item.name + " " + formatYen(item.amount)).join(" / ") || "商品明細なし"}</p><div className="flex flex-wrap items-center gap-2"><Badge variant="secondary">状態: {card.receipt.progress}</Badge><ReceiptStatusBadge status={card.receipt.status} /></div><div className="flex flex-wrap items-start gap-2"><Button asChild variant="outline" size="sm"><Link href={'/receipts/' + card.receipt.id}>詳細を見る</Link></Button>{(card.receipt.status === "REVIEW_REQUIRED" || card.receipt.status === "CONFIRMED") && <UnmatchControl receiptId={card.receipt.id} onDone={reload} />}</div>{card.receipt.status !== "REVIEW_REQUIRED" && card.receipt.status !== "CONFIRMED" && <p className="text-xs text-muted-foreground">Zaimへの登録を始めているため、対応を解除できません</p>}</CardContent></Card>)}
                    </TabsContent>
                    <TabsContent value="dismissed" className="space-y-4">
                        {overview.dismissedCards.length === 0 ? <EmptyCard>対応しないに記録したカード明細はありません。</EmptyCard> : overview.dismissedCards.map((card) => <Card key={card.moneyId}><CardHeader className="grid-cols-1 gap-2 sm:flex-row sm:items-start sm:justify-between"><CardTitleBlock card={card} /><Button variant="outline" size="sm" onClick={() => handlers.restoreCard(card.moneyId)} disabled={busy !== null}>{busy === "card:" + card.moneyId ? <Loader2 className="animate-spin" /> : <RotateCcw />}未対応に戻す</Button></CardHeader><CardContent className="border-t pt-4"><Badge variant="secondary">対応しない</Badge></CardContent></Card>)}
                    </TabsContent>
                    <TabsContent value="setAside" className="space-y-2">
                        <p className="text-xs text-muted-foreground">使わないにした取り込み明細です。データは残しているので、再取り込みしても作業一覧には戻りません。</p>
                        {overview.setAsideReceipts.length === 0 ? <EmptyCard>使わないにした取り込み明細はありません。</EmptyCard> : <div className="divide-y rounded-lg border bg-card">{overview.setAsideReceipts.map((row) => <SetAsideRow key={row.id} row={row} handlers={handlers} />)}</div>}
                    </TabsContent>
                    <TabsContent value="imported"><ImportedReceiptList /></TabsContent>
                    <TabsContent value="cleanup"><ZaimCleanupList /></TabsContent>
                </Tabs>
            </section>
            <p className="text-xs text-muted-foreground">移行時の安全措置として、{day(overview.startsAfter)} 以前のカード明細は作業一覧へ表示していません。詳細明細を選択後、日付・金額・商品・カテゴリ／内訳を確認して反映待ち口座へ登録します。Zaimアプリで標準の「置き換え」を行ってください。</p>
            <Link className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline" href="/data-fetch"><ExternalLink className="size-3" />Zaim連携の設定を確認する</Link>
        </main>
    )
}

interface Handlers {
    busy: string | null
    searching: boolean
    search: () => void
    select: (receiptId: number, card: CardReconciliationCard, samePaymentIds: number[]) => void
    dismiss: (card: CardReconciliationCard) => void
    setAside: (receiptId: number) => void
    restoreReceipt: (receiptId: number) => void
    restoreCard: (moneyId: number) => void
}

/** 区分付きの一覧から、サーバーアクションへ渡すカード明細の値だけを取り出す。 */
function cardOf(card: CardReconciliationCard): CardReconciliationCard {
    return { moneyId: card.moneyId, date: card.date, amount: card.amount, account: card.account, place: card.place, name: card.name }
}

function triageDetail(card: TriagedCard, overview: CardReconciliationOverview) {
    return { candidateCount: card.candidates.length, search: overview.search, lookbackDays: overview.detailPool.lookbackDays }
}

function countLabels(labels: string[]): string {
    const counts = new Map<string, number>()
    for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1)
    return [...counts.entries()].map(([label, count]) => `${label} ${count}`).join(" ・ ")
}

/** カード明細と詳細明細の取得状況。区分の根拠になる時刻をいつも見えるところに出す。 */
function SourceStatus({ overview }: { overview: CardReconciliationOverview }) {
    const { search } = overview
    let searchText = "詳細明細はまだ探していません"
    let tone = "bg-amber-500"
    if (search.searchedAt) {
        searchText = `詳細明細を最後に探した ${dateTime(search.searchedAt)}`
        if (search.error) searchText += "（失敗）"
        else if (search.webReason) searchText += "（スマートレシートは読めず）"
        else tone = "bg-emerald-500"
    }
    return (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span><span className={"mr-1.5 inline-block size-1.5 rounded-full align-middle " + (overview.stale || !overview.fetchedAt ? "bg-amber-500" : "bg-emerald-500")} />Zaim一覧 {overview.fetchedAt ? dateTime(overview.fetchedAt) + " 取得" : "取得時刻不明"}</span>
            <span><span className={"mr-1.5 inline-block size-1.5 rounded-full align-middle " + tone} />{searchText}</span>
        </div>
    )
}

function SummaryTile({ bucket, title, count, note }: { bucket: TriageBucket; title: string; count: number; note: string }) {
    const border = { action: "border-t-emerald-500", decide: "border-t-amber-500", rest: "border-t-muted-foreground/40" }[bucket]
    return (
        <div className={"min-w-0 rounded-lg border border-t-[3px] bg-card px-3 py-2 " + border}>
            <div className="text-xs font-semibold sm:text-sm">{title}</div>
            <div className="text-xl font-semibold tabular-nums sm:text-2xl">{count}</div>
            <div className="hidden text-xs text-muted-foreground sm:block">{note}</div>
        </div>
    )
}

function SectionTitle({ bucket, label, title, count }: { bucket: TriageBucket; label: string; title: string; count: number }) {
    return <h2 className="flex items-center gap-2 text-base font-semibold"><ReasonBadge bucket={bucket} label={label} />{title}<span className="text-xs font-normal tabular-nums text-muted-foreground">{count}件</span></h2>
}

function CardItem({ card, overview, handlers }: { card: TriagedCard; overview: CardReconciliationOverview; handlers: Handlers }) {
    const { busy } = handlers
    const text = describeCardTriage(card.triage.reason, triageDetail(card, overview))
    const needsSearch = card.triage.reason === "notSearched" || card.triage.reason === "searchFailed" || card.triage.reason === "webUnavailable"
    const samePayment = card.triage.samePaymentIds
    const contested = new Set(card.triage.contestedIds)
    return (
        <Card className="gap-3 py-4">
            <CardHeader className="grid-cols-1 gap-1 px-4"><CardTitleBlock card={card} /></CardHeader>
            <CardContent className="space-y-3 px-4">
                <p className="text-sm"><ReasonBadge bucket={card.triage.bucket} label={text.label} /><span className="ml-2">{text.why}</span></p>
                {text.next && <p className="text-xs text-muted-foreground">次の操作: {text.next}</p>}
                {card.candidates.length > 0 && <div className="space-y-2 border-t border-dashed pt-3">
                    {samePayment.length > 0 && <p className="text-xs text-muted-foreground">同じ支払い（どちらか1つを使います。使わなかった方は作業不要へ移り、削除はしません）</p>}
                    {card.candidates.map((candidate) => <CandidateRow key={candidate.id} candidate={candidate} card={card} contested={contested.has(candidate.id)}
                        primary={card.triage.bucket === "action"} busy={busy} onSelect={() => handlers.select(candidate.id, cardOf(card), samePayment)} />)}
                </div>}
                <div className="flex flex-wrap gap-2">
                    {needsSearch && <Button variant="outline" size="sm" onClick={handlers.search} disabled={handlers.searching || busy !== null}>{handlers.searching ? <Loader2 className="animate-spin" /> : <Search />}詳細明細を探す</Button>}
                    {needsSearch && <Button asChild variant="ghost" size="sm"><Link href="/data-fetch"><ExternalLink />連携の設定を確認する</Link></Button>}
                    <Button variant="ghost" size="sm" onClick={() => handlers.dismiss(card)} disabled={busy !== null}>{busy === "card:" + card.moneyId ? <Loader2 className="animate-spin" /> : null}対応しない（カード明細のまま）</Button>
                </div>
            </CardContent>
        </Card>
    )
}

function CandidateRow({ candidate, card, contested, primary, busy, onSelect }: { candidate: CardReconciliationCandidate; card: CardReconciliationCard; contested: boolean; primary: boolean; busy: string | null; onSelect: () => void }) {
    const gap = candidate.totalAmount !== null && candidate.totalAmount !== card.amount ? candidate.totalAmount - card.amount : null
    return (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
            <div className="min-w-0 flex-[1_1_220px]">
                <div className="flex flex-wrap items-baseline gap-x-2"><Badge variant="outline">{sourceLabel(candidate.source)}</Badge><span className="break-words font-medium">{candidate.storeName ?? "店舗名なし"}</span><span className="font-semibold tabular-nums">{formatYen(candidate.totalAmount)}</span>{gap !== null && <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">差 {formatYen(gap)}</span>}</div>
                <p className="mt-1 break-words text-xs text-muted-foreground">{day(candidate.purchasedAt)} ・ {candidate.itemPreview.map((item) => item.name + " " + formatYen(item.amount)).join(" / ") || "商品明細なし"}</p>
                {contested && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">別のカード明細もこの明細を候補にしています</p>}
            </div>
            <Button size="sm" variant={primary ? "default" : "outline"} onClick={onSelect} disabled={busy !== null}>{busy === "select:" + candidate.id ? <Loader2 className="animate-spin" /> : <Check />}{primary ? "この明細で準備する" : "この明細を使う"}</Button>
        </div>
    )
}

function ReceiptLine({ receipt }: { receipt: CardReconciliationCandidate }) {
    return (
        <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2"><Badge variant="outline">{sourceLabel(receipt.source)}</Badge><span className="break-words font-medium">{receipt.storeName ?? "店舗名なし"}</span><span className="font-semibold tabular-nums">{formatYen(receipt.totalAmount)}</span></div>
            <p className="mt-1 break-words text-xs text-muted-foreground">{day(receipt.purchasedAt)} ・ 取り込み明細{receipt.itemPreview.length > 0 ? " ・ " + receipt.itemPreview.slice(0, 3).map((item) => item.name).join(" / ") : ""}</p>
        </div>
    )
}

function LooseItem({ receipt, handlers }: { receipt: LooseReceipt; handlers: Handlers }) {
    const text = describeReceiptTriage(receipt.triage.reason)
    return (
        <Card className="gap-3 py-4">
            <CardContent className="space-y-3 px-4">
                <ReceiptLine receipt={receipt} />
                <p className="text-sm"><ReasonBadge bucket={receipt.triage.bucket} label={text.label} /><span className="ml-2">{text.why}</span></p>
                {text.next && <p className="text-xs text-muted-foreground">次の操作: {text.next}</p>}
                <div className="flex flex-wrap gap-2">
                    <Button asChild variant="outline" size="sm"><Link href={"/receipts/" + receipt.id}>詳細を見る</Link></Button>
                    {receipt.deletable && <SetAsideButton id={receipt.id} handlers={handlers} />}
                </div>
            </CardContent>
        </Card>
    )
}

function SetAsideButton({ id, handlers }: { id: number; handlers: Handlers }) {
    return <Button variant="ghost" size="sm" onClick={() => handlers.setAside(id)} disabled={handlers.busy !== null}>{handlers.busy === "receipt:" + id ? <Loader2 className="animate-spin" /> : <EyeOff />}使わない</Button>
}

function RestCardRow({ card, overview, handlers }: { card: TriagedCard; overview: CardReconciliationOverview; handlers: Handlers }) {
    const text = describeCardTriage(card.triage.reason, triageDetail(card, overview))
    return (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
            <div className="min-w-0 flex-[1_1_260px]"><ReasonBadge bucket="rest" label={text.label} /><span className="ml-2 break-words">{day(card.date)} {card.account} {card.place ?? card.name ?? "店舗名なし"}</span> <span className="font-semibold tabular-nums">{formatYen(card.amount)}</span></div>
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{text.why}</span>{card.triage.reason === "noCandidate" && <Button variant="ghost" size="sm" onClick={() => handlers.dismiss(card)} disabled={handlers.busy !== null}>対応しない</Button>}</div>
        </div>
    )
}

function RestReceiptRow({ receipt, handlers }: { receipt: LooseReceipt; handlers: Handlers }) {
    const text = describeReceiptTriage(receipt.triage.reason)
    return (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
            <div className="min-w-0 flex-[1_1_260px]"><ReasonBadge bucket="rest" label={text.label} /><span className="ml-2 break-words">{day(receipt.purchasedAt)} {sourceLabel(receipt.source)} {receipt.storeName ?? "店舗名なし"}</span> <span className="font-semibold tabular-nums">{formatYen(receipt.totalAmount)}</span></div>
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{text.why}</span>{receipt.deletable && receipt.triage.reason !== "awaitingCard" && <SetAsideButton id={receipt.id} handlers={handlers} />}</div>
        </div>
    )
}

function SetAsideRow({ row, handlers, compact = false }: { row: SetAsideReceipt; handlers: Handlers; compact?: boolean }) {
    const why = row.reason === "SAME_PAYMENT"
        ? `同じ支払いは${row.chosen ? sourceLabel(row.chosen.source) + "の明細" : "別の明細"}で対応済み`
        : "使わないにしました"
    return (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
            <div className="min-w-0 flex-[1_1_260px]">{compact && <ReasonBadge bucket="rest" label="同じ支払いは対応済み" />}<span className={compact ? "ml-2 break-words" : "break-words"}>{day(row.purchasedAt)} {sourceLabel(row.source)} {row.storeName ?? "店舗名なし"}</span> <span className="font-semibold tabular-nums">{formatYen(row.totalAmount)}</span></div>
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{why}（{dateTime(row.setAsideAt)}）</span><Button variant="ghost" size="sm" onClick={() => handlers.restoreReceipt(row.id)} disabled={handlers.busy !== null}>{handlers.busy === "receipt:" + row.id ? <Loader2 className="animate-spin" /> : <RotateCcw />}使う明細に戻す</Button></div>
        </div>
    )
}

function CardTitleBlock({ card }: { card: CardReconciliationCard }) {
    return <div className="min-w-0"><Badge variant="secondary">{card.account}</Badge><CardTitle className="mt-2 break-words text-lg">{card.place ?? card.name ?? "店舗名なし"} <span className="ml-2 tabular-nums">{formatYen(card.amount)}</span></CardTitle><CardDescription>{day(card.date)} ・ Zaimカード連携明細</CardDescription></div>
}

function EmptyNote({ children }: { children: React.ReactNode }) {
    return <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">{children}</p>
}

function EmptyCard({ children }: { children: React.ReactNode }) {
    return <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">{children}</CardContent></Card>
}
