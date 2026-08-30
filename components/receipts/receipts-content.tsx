"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Download, Link2, Loader2, RefreshCw, ScanLine, Send } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { GenreSuggestions } from "@/components/receipts/genre-suggestions"
import { LinkageSettings } from "@/components/receipts/linkage-settings"
import {
    formatJstDate,
    formatYen,
    ReceiptSourceBadge,
    ReceiptStatusBadge,
    ReviewLevelBadge,
} from "@/components/receipts/receipt-status"
import {
    getReceiptOverviewAction,
    importLinkedReceiptsAction,
    refreshMatchCandidatesAction,
    sendConfirmedReceiptsToZaimAction,
    syncZaimMastersAction,
    type ReceiptOverview,
    type ReceiptSummary,
} from "@/app/actions/receipts"

/** 一覧の並び。「今やることがあるもの」を上に置く。 */
const GROUPS: Array<{ key: string; title: string; description: string; statuses: string[] }> = [
    {
        key: "review",
        title: "確認待ち",
        description: "AIの読み取りを確認・修正してから確定します",
        statuses: ["REVIEW_REQUIRED", "ANALYZING"],
    },
    {
        key: "confirmed",
        title: "確定済み",
        description: "Zaimの「反映待ち」へ登録できます",
        statuses: ["CONFIRMED"],
    },
    {
        key: "sent",
        title: "反映待ちへ登録済み",
        description: "カード明細が反映されたら、Zaimの「置き換え」で統合します",
        statuses: ["SENT_TO_ZAIM"],
    },
    { key: "failed", title: "解析失敗", description: "内容を確認して取り直してください", statuses: ["FAILED"] },
]

interface ReceiptsContentProps {
    initialData: ReceiptOverview | null
    initialError: string | null
}

/**
 * 家計簿連携の画面（Issue #271）。
 *
 * 「明細 / 内訳の提案 / 設定」の3タブに分けている。**写真からのレシート撮影は画面から外した**
 * （解析のコード・保存先・DBはそのまま残してあるので、必要になれば導線を戻すだけで復活する）。
 */
export function ReceiptsContent({ initialData, initialError }: ReceiptsContentProps) {
    const router = useRouter()
    const [data, setData] = React.useState<ReceiptOverview | null>(initialData)
    const [error] = React.useState<string | null>(initialError)
    const [syncing, setSyncing] = React.useState(false)
    const [matching, setMatching] = React.useState(false)
    const [importing, setImporting] = React.useState(false)
    const [sending, setSending] = React.useState(false)
    const [suggestionCount, setSuggestionCount] = React.useState(0)

    const reload = React.useCallback(async () => {
        const result = await getReceiptOverviewAction()
        if (result.success) setData(result.data)
    }, [])

    const syncMasters = async () => {
        setSyncing(true)
        try {
            const result = await syncZaimMastersAction()
            if (!result.success) {
                toast.error(result.error)
                return
            }
            toast.success(
                "Zaimの内訳 " + result.data.genres + " 件、口座 " + result.data.accounts + " 件を取得しました"
            )
            await reload()
            router.refresh()
        } finally {
            setSyncing(false)
        }
    }

    const importLinked = async () => {
        setImporting(true)
        try {
            const result = await importLinkedReceiptsAction()
            if (!result.success) {
                toast.error(result.error)
                return
            }
            const { created, updated, items, autoConfirmed, autoCopied } = result.data
            if (items === 0) {
                toast.info("新しく取り込む連携明細はありませんでした")
            } else {
                toast.success(
                    `スマートレシート・Amazonの明細 ${items} 件を取り込みました（新規 ${created} 件 / 追加 ${updated} 件・自動確定 ${autoConfirmed} 件）`
                )
            }
            if (autoCopied > 0) {
                toast.success("自動コピーで " + autoCopied + " 件を複製しました")
            }
            if (!result.data.aiUsed && items > 0) {
                toast.info("ANTHROPIC_API_KEY が未設定のため、内訳はZaimの分類と履歴だけで補正しました")
            }
            await reload()
            router.refresh()
        } finally {
            setImporting(false)
        }
    }

    const sendConfirmed = async () => {
        setSending(true)
        try {
            const result = await sendConfirmedReceiptsToZaimAction()
            if (!result.success) {
                toast.error(result.error)
                return
            }
            const { sent, failed, firstError } = result.data
            if (sent > 0) toast.success(sent + " 件を「反映待ち」へ登録しました")
            if (failed > 0) toast.error(failed + " 件の登録に失敗しました: " + (firstError ?? ""))
            if (sent === 0 && failed === 0) toast.info("確定済みの明細がありません")
            await reload()
            router.refresh()
        } finally {
            setSending(false)
        }
    }

    const refreshCandidates = async () => {
        setMatching(true)
        try {
            const result = await refreshMatchCandidatesAction()
            if (!result.success) {
                toast.error(result.error)
                return
            }
            toast.success(
                result.data.candidates > 0
                    ? "置き換え候補が " + result.data.candidates + " 件見つかりました"
                    : "置き換え候補は見つかりませんでした"
            )
            await reload()
            router.refresh()
        } finally {
            setMatching(false)
        }
    }

    if (error) {
        return (
            <div className="p-4">
                <Card>
                    <CardContent className="py-8 text-center text-sm text-muted-foreground">
                        {error}
                    </CardContent>
                </Card>
            </div>
        )
    }

    const status = data?.status
    const receipts = data?.receipts ?? []

    const statusItems = [
        { label: "Zaim API", ok: Boolean(status?.zaimConfigured), hint: "ZAIM_CONSUMER_KEY ほか" },
        {
            label: "反映待ち口座",
            ok: Boolean(status?.pendingAccountConfigured),
            hint: "ZAIM_PENDING_ACCOUNT_ID",
        },
        { label: "内訳マスタ", ok: (status?.genreCount ?? 0) > 0, hint: (status?.genreCount ?? 0) + "件" },
        { label: "AI分類", ok: Boolean(status?.aiConfigured), hint: "ANTHROPIC_API_KEY" },
        { label: "Gmail", ok: Boolean(status?.gmailConfigured), hint: "GMAIL_REFRESH_TOKEN" },
        {
            label: "連携口座",
            ok: (status?.linkedAccounts.length ?? 0) > 0,
            hint:
                status?.linkedAccounts.map((account) => account.accountName).join(" / ") ||
                "スマートレシート / Amazon",
        },
    ]

    const settingsToolbar = (
        <div className="flex flex-wrap gap-2">
            <Button
                variant="outline"
                size="sm"
                onClick={syncMasters}
                disabled={syncing || !status?.zaimConfigured}
            >
                {syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                Zaimのマスタを更新
            </Button>
            <Button
                variant="outline"
                size="sm"
                onClick={importLinked}
                disabled={
                    importing || !status?.zaimConfigured || (status?.linkedAccounts.length ?? 0) === 0
                }
            >
                {importing ? <Loader2 className="animate-spin" /> : <Download />}
                Zaim連携明細を取り込む
            </Button>
            <Button
                variant="outline"
                size="sm"
                onClick={refreshCandidates}
                disabled={matching || !status?.zaimConfigured}
            >
                {matching ? <Loader2 className="animate-spin" /> : <Link2 />}
                置き換え候補を更新
            </Button>
        </div>
    )

    return (
        <div className="mx-auto w-full max-w-3xl space-y-4 p-4 pb-24">
            <Tabs defaultValue="receipts">
                <TabsList className="w-full">
                    <TabsTrigger value="receipts">明細</TabsTrigger>
                    <TabsTrigger value="suggestions">
                        内訳の提案
                        {suggestionCount > 0 && <Badge variant="secondary">{suggestionCount}</Badge>}
                    </TabsTrigger>
                    <TabsTrigger value="settings">設定</TabsTrigger>
                </TabsList>

                <TabsContent value="receipts" className="space-y-4">
                    {settingsToolbar}

                    {GROUPS.map((group) => {
                        const rows = receipts.filter((receipt) => group.statuses.includes(receipt.status))
                        if (rows.length === 0) return null
                        return (
                            <Card key={group.key}>
                                <CardHeader>
                                    <CardTitle className="text-base">
                                        {group.title}
                                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                                            {rows.length}件
                                        </span>
                                    </CardTitle>
                                    <CardDescription>{group.description}</CardDescription>
                                    {group.key === "confirmed" && (
                                        <div className="pt-2">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={sendConfirmed}
                                                disabled={
                                                    sending ||
                                                    !status?.zaimConfigured ||
                                                    !status?.pendingAccountConfigured
                                                }
                                            >
                                                {sending ? <Loader2 className="animate-spin" /> : <Send />}
                                                まとめて「反映待ち」へ登録
                                            </Button>
                                        </div>
                                    )}
                                </CardHeader>
                                <CardContent className="space-y-2">
                                    {rows.map((receipt) => (
                                        <ReceiptRow key={receipt.id} receipt={receipt} />
                                    ))}
                                </CardContent>
                            </Card>
                        )
                    })}

                    {receipts.length === 0 && (
                        <Card>
                            <CardContent className="py-10 text-center text-sm text-muted-foreground">
                                <ScanLine className="mx-auto mb-3 size-8 opacity-40" />
                                取り込んだ明細はまだありません
                            </CardContent>
                        </Card>
                    )}
                </TabsContent>

                <TabsContent value="suggestions">
                    <GenreSuggestions
                        zaimConfigured={Boolean(status?.zaimConfigured)}
                        onCountChange={setSuggestionCount}
                    />
                </TabsContent>

                <TabsContent value="settings">
                    <LinkageSettings
                        accounts={status?.accounts ?? []}
                        zaimConfigured={Boolean(status?.zaimConfigured)}
                        gmailConfigured={Boolean(status?.gmailConfigured)}
                        toolbar={settingsToolbar}
                        statusItems={statusItems}
                    />
                </TabsContent>
            </Tabs>
        </div>
    )
}

function ReceiptRow({ receipt }: { receipt: ReceiptSummary }) {
    return (
        <Link
            href={"/receipts/" + receipt.id}
            className="block rounded-lg border p-3 transition-colors hover:bg-accent"
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="truncate font-medium">{receipt.storeName ?? "店舗名なし"}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                        {formatJstDate(receipt.purchasedAt ?? receipt.createdAt)}・
                        {receipt.itemCount}品
                    </div>
                </div>
                <div className="shrink-0 text-right">
                    <div className="font-semibold tabular-nums">
                        {formatYen(receipt.totalAmount)}
                    </div>
                </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <ReceiptSourceBadge source={receipt.source} />
                <ReceiptStatusBadge status={receipt.status} />
                {receipt.status !== "SENT_TO_ZAIM" && receipt.status !== "FAILED" && (
                    <ReviewLevelBadge level={receipt.verify.level} />
                )}
                {receipt.candidateCount > 0 && (
                    <Badge variant="default">置き換え候補 {receipt.candidateCount}件</Badge>
                )}
                {!receipt.verify.matched && receipt.status !== "FAILED" && (
                    <Badge variant="destructive">金額不一致</Badge>
                )}
            </div>
        </Link>
    )
}
