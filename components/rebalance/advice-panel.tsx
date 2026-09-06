"use client"

import * as React from "react"
import { Loader2, RotateCcw, Send, Sparkles } from "lucide-react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { InvestmentProfileForm } from "@/components/rebalance/investment-profile-form"
import { requestAdvice } from "@/app/actions/rebalance-advice"
import { formatRatio } from "@/components/rebalance/format"
import type { AllocationRow, ProposalMode, RebalanceAxis } from "@/lib/rebalance"
import type {
    AdviceTurn,
    AdviceVerdict,
    AllocationSuggestionItem,
    InvestmentProfile,
    RebalanceAdvice,
} from "@/lib/rebalance-advice"

interface AdvicePanelProps {
    axis: RebalanceAxis
    axisLabel: string
    mode: ProposalMode
    extraAmount: number
    threshold: number
    rows: AllocationRow[]
    aiAvailable: boolean
    adviceModel: string
    profile: InvestmentProfile
    monthlyDeposit: number | null
    onProfileSaved: (profile: InvestmentProfile) => void
    /** 「目標編集に取り込む」。提案の比率を編集ダイアログの初期値にする */
    onApplyAllocation: (items: { key: string; ratio: number }[]) => void
}

interface TranscriptEntry {
    role: "user" | "assistant"
    text: string
}

const VERDICT_STYLE: Record<AdviceVerdict, string> = {
    act: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    partial: "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400",
    hold: "border-border bg-muted text-muted-foreground",
    undecided: "border-border bg-muted text-muted-foreground",
}

const DISCLAIMER = "投資判断はご自身で。個別銘柄は勧めません"

function axisKey(axis: RebalanceAxis): string {
    return axis.kind === "category" ? "category" : `tagGroup:${axis.tagGroupId}`
}

function PointList({
    label,
    color,
    points,
    empty,
}: {
    label: string
    color: string
    points: { title: string; detail: string }[]
    empty: string
}) {
    return (
        <div className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground">
                <i className={`inline-block h-2 w-2 rounded-[2px] ${color}`} aria-hidden />
                {label}
            </span>
            {points.length === 0 ? (
                <p className="rounded-md bg-muted/60 px-2.5 py-2 text-[11px] text-muted-foreground">{empty}</p>
            ) : (
                points.map((point, index) => (
                    <div key={index} className="grid grid-cols-[18px_1fr] gap-1.5 rounded-md bg-muted/60 px-2.5 py-2">
                        <span className="pt-0.5 text-[10px] font-bold text-muted-foreground">{index + 1}</span>
                        <div>
                            <div className="text-[11px] font-bold">{point.title}</div>
                            <div className="text-[11px] leading-relaxed text-muted-foreground">{point.detail}</div>
                        </div>
                    </div>
                ))
            )}
        </div>
    )
}

function AllocationList({
    items,
    basis,
    rows,
    onApply,
}: {
    items: AllocationSuggestionItem[]
    basis: string
    rows: AllocationRow[]
    onApply: () => void
}) {
    const colorByKey = new Map(rows.map((row) => [row.key, row.color]))
    return (
        <div className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground">
                <i className="inline-block h-2 w-2 rounded-[2px] bg-indigo-500" aria-hidden />
                あなたに合う配分の提案（現在の目標 → 提案）
            </span>
            <div className="overflow-hidden rounded-md border border-indigo-500/35">
                {items.map((item) => {
                    const from = item.currentTarget
                    const changed = from == null || Math.abs(from - item.ratio) >= 0.05
                    const direction = from != null && changed ? (item.ratio > from ? "up" : "down") : "same"
                    return (
                        <div
                            key={item.key}
                            className="grid grid-cols-[1fr_auto] items-center gap-x-2.5 gap-y-1 border-b px-2.5 py-2 last:border-b-0 md:grid-cols-[minmax(120px,1fr)_140px_minmax(200px,2fr)]"
                        >
                            <div className="flex min-w-0 items-center gap-2">
                                <span
                                    className="h-2 w-2 shrink-0 rounded-full"
                                    style={{ backgroundColor: colorByKey.get(item.key) ?? "var(--muted-foreground)" }}
                                />
                                <span className="truncate text-xs font-bold">{item.name}</span>
                            </div>
                            <div className="whitespace-nowrap text-xs font-bold tabular-nums">
                                <span className="font-medium text-muted-foreground">
                                    {from != null ? `${formatRatio(from)}%` : "--"}
                                </span>
                                <span className="mx-1 text-muted-foreground">→</span>
                                <span
                                    className={direction === "up"
                                        ? "text-sky-600 dark:text-sky-400"
                                        : direction === "down"
                                            ? "text-amber-600 dark:text-amber-400"
                                            : ""}
                                >
                                    {formatRatio(item.ratio)}%
                                    {direction === "same" && from != null && (
                                        <span className="ml-1 text-[10px] font-medium text-muted-foreground">据え置き</span>
                                    )}
                                </span>
                            </div>
                            <div className="col-span-2 text-[10px] leading-relaxed text-muted-foreground md:col-span-1">
                                {item.reason}
                            </div>
                        </div>
                    )
                })}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                <span>合計 100% ・ {basis || "登録済みの項目の中で組んでいます"}</span>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="ml-auto h-7 border-indigo-500/35 bg-indigo-500/10 text-[10px] text-indigo-600 hover:bg-indigo-500/15 dark:text-indigo-300"
                    onClick={onApply}
                >
                    この配分を目標編集に取り込む
                </Button>
            </div>
        </div>
    )
}

export function AdvicePanel({
    axis,
    axisLabel,
    mode,
    extraAmount,
    threshold,
    rows,
    aiAvailable,
    adviceModel,
    profile,
    monthlyDeposit,
    onProfileSaved,
    onApplyAllocation,
}: AdvicePanelProps) {
    const [advice, setAdvice] = React.useState<RebalanceAdvice | null>(null)
    const [turns, setTurns] = React.useState<AdviceTurn[]>([])
    const [transcript, setTranscript] = React.useState<TranscriptEntry[]>([])
    const [draft, setDraft] = React.useState("")
    const [isLoading, setIsLoading] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)
    const composeRef = React.useRef<HTMLTextAreaElement>(null)

    const reset = React.useCallback(() => {
        setAdvice(null)
        setTurns([])
        setTranscript([])
        setDraft("")
        setError(null)
    }, [])

    // 集計軸を切り替えたら、別の項目集合に対する見立てになるので最初から
    const currentAxisKey = axisKey(axis)
    const lastAxisKey = React.useRef(currentAxisKey)
    React.useEffect(() => {
        if (lastAxisKey.current !== currentAxisKey) {
            lastAxisKey.current = currentAxisKey
            reset()
        }
    }, [currentAxisKey, reset])

    const ask = async (message?: string) => {
        setIsLoading(true)
        setError(null)
        try {
            const result = await requestAdvice({ axis, mode, extraAmount, threshold, turns, message })
            if (!result.success) {
                setError(result.error)
                return
            }
            const next = result.advice
            setAdvice(next)
            setTurns((prev) => [
                ...prev,
                ...(message ? [{ role: "user" as const, content: message }] : []),
                { role: "assistant" as const, content: JSON.stringify(next) },
            ])
            setTranscript((prev) => [
                ...prev,
                ...(message ? [{ role: "user" as const, text: message }] : []),
                { role: "assistant" as const, text: `${next.verdictLabel}。${next.headline}` },
            ])
            setDraft("")
        } catch (err) {
            console.error("Failed to request rebalance advice:", err)
            setError("AIの見立ての取得に失敗しました")
        } finally {
            setIsLoading(false)
        }
    }

    const send = () => {
        const message = draft.trim()
        if (!message || isLoading) return
        void ask(message)
    }

    const pickQuestion = (question: string) => {
        setDraft((prev) => (prev.trim() ? `${prev.trim()}\n${question}\n` : `${question}\n`))
        composeRef.current?.focus()
    }

    return (
        <Card className="gap-0 overflow-hidden border-indigo-500/35 py-0">
            <CardHeader className="flex flex-row items-center gap-2 border-b bg-gradient-to-r from-indigo-500/10 to-transparent px-3 py-2.5 [.border-b]:pb-2.5 md:px-4">
                <Sparkles className="h-3.5 w-3.5 shrink-0 text-indigo-500 dark:text-indigo-300" />
                <span className="text-xs font-bold">AIと根拠を考える</span>
                <span className="ml-auto text-right text-[10px] text-muted-foreground">{DISCLAIMER}</span>
            </CardHeader>

            <CardContent className="flex flex-col gap-3 p-3 md:p-4">
                <InvestmentProfileForm
                    key={`${profile.birthYear}-${profile.retirementAge}-${profile.riskTolerance}-${profile.investmentNote}`}
                    profile={profile}
                    monthlyDeposit={monthlyDeposit}
                    onSaved={onProfileSaved}
                />

                {!advice && (
                    <div className="flex flex-col items-center gap-2.5 py-4 text-center">
                        <p className="text-[13px] font-bold">いまリバランスすべきか、根拠から一緒に考えます</p>
                        <p className="max-w-[46ch] text-xs text-muted-foreground">
                            {aiAvailable
                                ? `${axisLabel}のズレ・提案の内容・直近30日の値動き・投資プロフィールをClaudeに渡し、動く根拠と見送る理由、あなたに合う配分を整理します。足りない情報は質問として返ってきます。`
                                : "サーバーに ANTHROPIC_API_KEY が設定されていないため、この機能は使えません。"}
                        </p>
                        {isLoading ? (
                            <span className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-500" />
                                {axisLabel}のズレ・提案と投資プロフィールを読んでいます…
                            </span>
                        ) : (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 border-indigo-500/35 bg-indigo-500/10 text-[11px] text-indigo-600 hover:bg-indigo-500/15 dark:text-indigo-300"
                                onClick={() => void ask()}
                                disabled={!aiAvailable}
                            >
                                <Sparkles className="h-3 w-3" />
                                根拠を考えてもらう
                            </Button>
                        )}
                        {error && <p className="text-[11px] text-red-500">{error}</p>}
                    </div>
                )}

                {advice && (
                    <>
                        <div className="flex flex-col gap-1.5">
                            <span
                                className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${VERDICT_STYLE[advice.verdict]}`}
                            >
                                <Sparkles className="h-3 w-3" />
                                {advice.verdictLabel}
                            </span>
                            <p className="max-w-[72ch] text-[13px] font-semibold leading-relaxed">{advice.headline}</p>
                        </div>

                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <PointList
                                label="いま動く根拠"
                                color="bg-amber-500"
                                points={advice.reasons}
                                empty="いま動く根拠は見当たりませんでした。"
                            />
                            <PointList
                                label="見送る理由・注意点"
                                color="bg-sky-500"
                                points={advice.cautions}
                                empty="特に注意点はありません。"
                            />
                        </div>

                        {advice.allocation && (
                            <AllocationList
                                items={advice.allocation.items}
                                basis={advice.allocation.basis}
                                rows={rows}
                                onApply={() =>
                                    onApplyAllocation(
                                        advice.allocation!.items.map((item) => ({ key: item.key, ratio: item.ratio }))
                                    )}
                            />
                        )}

                        {advice.questions.length > 0 && (
                            <div className="flex flex-col gap-1.5">
                                <span className="text-[10px] font-bold text-muted-foreground">
                                    判断のために教えてください（押すと入力欄に入ります）
                                </span>
                                <div className="flex flex-wrap gap-1.5">
                                    {advice.questions.map((question) => (
                                        <button
                                            key={question}
                                            type="button"
                                            onClick={() => pickQuestion(question)}
                                            className="rounded-full border border-indigo-500/35 bg-indigo-500/10 px-2.5 py-1 text-left text-[11px] leading-snug transition-colors hover:bg-indigo-500/15"
                                        >
                                            <span className="mr-1.5 inline-grid h-3.5 w-3.5 place-items-center rounded-full bg-indigo-500 text-[9px] font-bold text-white">
                                                ?
                                            </span>
                                            {question}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="flex flex-col gap-1.5 border-t border-dashed pt-3">
                            {transcript.map((entry, index) => (
                                <div
                                    key={index}
                                    className={`max-w-[92%] rounded-xl px-2.5 py-1.5 text-[11px] leading-relaxed ${entry.role === "user"
                                        ? "self-end rounded-br-sm bg-primary text-primary-foreground"
                                        : "self-start rounded-bl-sm bg-muted"}`}
                                >
                                    {entry.role === "assistant" && (
                                        <span className="block text-[9px] font-bold text-indigo-500 dark:text-indigo-300">Claude</span>
                                    )}
                                    <span className="whitespace-pre-wrap">{entry.text}</span>
                                </div>
                            ))}

                            <div className="flex items-end gap-1.5">
                                <textarea
                                    ref={composeRef}
                                    value={draft}
                                    onChange={(e) => setDraft(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                                            e.preventDefault()
                                            send()
                                        }
                                    }}
                                    placeholder="追加の情報や質問を書く…（Ctrl+Enter で送る）"
                                    rows={2}
                                    maxLength={2000}
                                    disabled={isLoading}
                                    aria-label="AIへの追記"
                                    className="min-h-[38px] flex-1 resize-y rounded-md border border-input bg-transparent px-2.5 py-2 text-xs shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30"
                                />
                                <Button
                                    type="button"
                                    size="sm"
                                    className="h-8 text-[11px]"
                                    onClick={send}
                                    disabled={isLoading || !draft.trim()}
                                >
                                    {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                                    送る
                                </Button>
                            </div>
                            {error && <p className="text-[11px] text-red-500">{error}</p>}
                            <div className="flex flex-wrap items-center justify-between gap-1.5 text-[10px] text-muted-foreground">
                                <span>
                                    使用モデル: {adviceModel} ・ 渡すのはこの画面の数値・直近30日の値動き・投資プロフィールだけ ・
                                    やり取りは保存されません（ページを離れると消えます）
                                </span>
                                <button
                                    type="button"
                                    onClick={reset}
                                    disabled={isLoading}
                                    className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground disabled:opacity-50"
                                >
                                    <RotateCcw className="h-3 w-3" />
                                    最初からやり直す
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    )
}
