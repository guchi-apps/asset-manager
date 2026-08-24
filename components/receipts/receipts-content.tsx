"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Camera, Link2, Loader2, RefreshCw, ScanLine } from "lucide-react"
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
import {
    formatJstDate,
    formatYen,
    ReceiptStatusBadge,
    ReviewLevelBadge,
} from "@/components/receipts/receipt-status"
import {
    getReceiptOverviewAction,
    refreshMatchCandidatesAction,
    syncZaimMastersAction,
    uploadReceiptAction,
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
    { key: "failed", title: "解析失敗", description: "画像を確認して取り直してください", statuses: ["FAILED"] },
]

interface ReceiptsContentProps {
    initialData: ReceiptOverview | null
    initialError: string | null
}

export function ReceiptsContent({ initialData, initialError }: ReceiptsContentProps) {
    const router = useRouter()
    const fileInputRef = React.useRef<HTMLInputElement>(null)
    const [data, setData] = React.useState<ReceiptOverview | null>(initialData)
    const [error] = React.useState<string | null>(initialError)
    const [uploading, setUploading] = React.useState(false)
    const [syncing, setSyncing] = React.useState(false)
    const [matching, setMatching] = React.useState(false)

    const reload = React.useCallback(async () => {
        const result = await getReceiptOverviewAction()
        if (result.success) setData(result.data)
    }, [])

    const handleFiles = async (files: FileList | null) => {
        if (!files || files.length === 0) return
        setUploading(true)
        try {
            // 複数枚まとめて選べるようにする。1枚ずつ送るのは、解析の失敗を1枚に閉じ込めるため。
            for (const file of Array.from(files)) {
                const formData = new FormData()
                formData.append("image", file)
                const result = await uploadReceiptAction(formData)
                if (!result.success) {
                    toast.error(result.error)
                    continue
                }
                if (result.data.duplicate) {
                    toast.info("同じ画像がすでに取り込まれています")
                } else if (result.data.status === "FAILED") {
                    toast.error("解析に失敗しました。一覧から内容を確認してください。")
                } else if (result.data.status === "CONFIRMED") {
                    toast.success("高信頼で読み取れたため、確定済みにしました")
                } else {
                    toast.success("読み取りました。内容を確認してください。")
                }
            }
            await reload()
        } finally {
            setUploading(false)
            if (fileInputRef.current) fileInputRef.current.value = ""
        }
    }

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
        } finally {
            setSyncing(false)
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

    return (
        <div className="mx-auto w-full max-w-3xl space-y-4 p-4 pb-24">
            <SetupCard
                status={status}
                syncing={syncing}
                matching={matching}
                onSyncMasters={syncMasters}
                onRefreshCandidates={refreshCandidates}
            />

            <Card>
                <CardContent className="pt-6">
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        capture="environment"
                        multiple
                        className="hidden"
                        onChange={(event) => handleFiles(event.target.files)}
                    />
                    <Button
                        size="lg"
                        className="h-16 w-full text-base"
                        disabled={uploading || !status?.aiConfigured}
                        onClick={() => fileInputRef.current?.click()}
                    >
                        {uploading ? (
                            <Loader2 className="animate-spin" />
                        ) : (
                            <Camera className="size-5" />
                        )}
                        {uploading ? "解析しています…" : "レシートを撮影・選択"}
                    </Button>
                    {!status?.aiConfigured && (
                        <p className="mt-3 text-center text-xs text-muted-foreground">
                            ANTHROPIC_API_KEY が未設定のため、解析を実行できません
                        </p>
                    )}
                </CardContent>
            </Card>

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
                        取り込んだレシートはまだありません
                    </CardContent>
                </Card>
            )}
        </div>
    )
}

function SetupCard({
    status,
    syncing,
    matching,
    onSyncMasters,
    onRefreshCandidates,
}: {
    status: ReceiptOverview["status"] | undefined
    syncing: boolean
    matching: boolean
    onSyncMasters: () => void
    onRefreshCandidates: () => void
}) {
    if (!status) return null

    const items: Array<{ label: string; ok: boolean; hint: string }> = [
        { label: "AI解析", ok: status.aiConfigured, hint: "ANTHROPIC_API_KEY" },
        { label: "Zaim API", ok: status.zaimConfigured, hint: "ZAIM_CONSUMER_KEY ほか" },
        {
            label: "反映待ち口座",
            ok: status.pendingAccountConfigured,
            hint: "ZAIM_PENDING_ACCOUNT_ID",
        },
        { label: "内訳マスタ", ok: status.genreCount > 0, hint: status.genreCount + "件" },
    ]

    const allReady = items.every((item) => item.ok)
    if (allReady) {
        return (
            <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={onSyncMasters} disabled={syncing}>
                    {syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                    Zaimのマスタを更新
                </Button>
                <Button variant="outline" size="sm" onClick={onRefreshCandidates} disabled={matching}>
                    {matching ? <Loader2 className="animate-spin" /> : <Link2 />}
                    置き換え候補を更新
                </Button>
            </div>
        )
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">連携の設定</CardTitle>
                <CardDescription>
                    すべて揃うと、撮影からZaimの「反映待ち」登録まで通しで使えます
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                    {items.map((item) => (
                        <div
                            key={item.label}
                            className="flex items-center justify-between rounded-md border px-3 py-2"
                        >
                            <div className="min-w-0">
                                <div className="truncate text-sm">{item.label}</div>
                                <div className="truncate text-[11px] text-muted-foreground">
                                    {item.hint}
                                </div>
                            </div>
                            <Badge variant={item.ok ? "outline" : "destructive"}>
                                {item.ok ? "済" : "未"}
                            </Badge>
                        </div>
                    ))}
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={onSyncMasters}
                        disabled={syncing || !status.zaimConfigured}
                    >
                        {syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                        Zaimのマスタを取得
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={onRefreshCandidates}
                        disabled={matching || !status.zaimConfigured}
                    >
                        {matching ? <Loader2 className="animate-spin" /> : <Link2 />}
                        置き換え候補を更新
                    </Button>
                </div>
            </CardContent>
        </Card>
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
