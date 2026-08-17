"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { CurrencyInput } from "@/components/ui/currency-input"
import type { ProposalMode, ProposalResult } from "@/lib/rebalance"
import { formatAmount, formatSignedAmount } from "@/components/rebalance/format"

interface ProposalPanelProps {
    proposal: ProposalResult
    mode: ProposalMode
    onModeChange: (mode: ProposalMode) => void
    extraAmount: string
    onExtraAmountChange: (value: string) => void
    hasTargets: boolean
    /** 集計軸がカテゴリのときだけ、取引履歴への引き継ぎができる */
    canRegisterTransaction: boolean
}

const QUICK_AMOUNTS = [50_000, 100_000, 300_000]

/** 取引履歴の登録ダイアログへ、資産と金額（売却はマイナス）を引き継ぐ */
function transactionHref(categoryId: number, amount: number): string {
    const params = new URLSearchParams({
        categoryId: String(categoryId),
        amount: String(Math.round(amount)),
    })
    return `/transactions?${params.toString()}`
}

export function ProposalPanel({
    proposal,
    mode,
    onModeChange,
    extraAmount,
    onExtraAmountChange,
    hasTargets,
    canRegisterTransaction,
}: ProposalPanelProps) {
    const extraValue = Number(extraAmount) || 0
    const addQuick = (amount: number) => {
        onExtraAmountChange(String(extraValue + amount))
    }

    return (
        <Card className="gap-0 overflow-hidden py-0">
            <CardHeader className="flex flex-row items-center gap-2 border-b px-3 py-2.5 [.border-b]:pb-2.5 md:px-4">
                <span className="text-xs font-bold">提案</span>
                <span className="ml-auto text-[10px] text-muted-foreground">
                    {mode === "buyOnly" ? "売らずに買い増しだけで近づける" : "売買して目標ちょうどに合わせる"}
                </span>
            </CardHeader>

            <CardContent className="flex flex-col gap-3 p-3 md:p-4">
                <div className="flex w-full rounded-md border bg-muted/50 p-0.5">
                    {([
                        { value: "buyOnly" as const, label: "買い増しのみ" },
                        { value: "buySell" as const, label: "売買あり" },
                    ]).map((item) => (
                        <button
                            key={item.value}
                            type="button"
                            onClick={() => onModeChange(item.value)}
                            aria-pressed={mode === item.value}
                            className={`flex-1 rounded-md px-3 py-1.5 text-[11px] font-bold transition-all ${mode === item.value
                                ? "bg-background text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground"}`}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>

                <div className="flex flex-col gap-1.5">
                    <label htmlFor="extra-amount" className="text-[10px] font-bold text-muted-foreground">
                        追加で投資できる金額
                        {mode === "buySell" && <span className="ml-1 font-normal">（任意）</span>}
                    </label>
                    <CurrencyInput
                        id="extra-amount"
                        value={extraAmount}
                        onChange={onExtraAmountChange}
                        placeholder="0"
                        className="text-right tabular-nums"
                    />
                    <div className="flex flex-wrap gap-1.5">
                        {QUICK_AMOUNTS.map((amount) => (
                            <button
                                key={amount}
                                type="button"
                                onClick={() => addQuick(amount)}
                                className="rounded-md border px-2 py-1 text-[10px] font-bold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            >
                                +{formatAmount(amount / 10000)}万
                            </button>
                        ))}
                        <button
                            type="button"
                            onClick={() => onExtraAmountChange("")}
                            className="rounded-md border px-2 py-1 text-[10px] font-bold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                            クリア
                        </button>
                    </div>
                </div>

                {!hasTargets ? (
                    <p className="rounded-md bg-muted/60 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
                        目標配分を設定すると、どこにいくら入れればよいかを提案します。
                    </p>
                ) : proposal.items.length === 0 ? (
                    <p className="rounded-md bg-muted/60 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
                        {mode === "buyOnly"
                            ? "追加で投資できる金額を入力すると、振り分け方を提案します。"
                            : "目標との差が小さいため、動かす必要はありません。"}
                    </p>
                ) : (
                    <div className="flex flex-col gap-1.5">
                        <div className="text-[10px] font-bold text-muted-foreground">
                            {mode === "buyOnly" ? "この金額をこう振り分けます" : "この売買で目標ちょうどになります"}
                        </div>
                        {proposal.items.map((item) => (
                            <div
                                key={item.key}
                                className="flex items-center gap-2 rounded-md bg-muted/60 px-2.5 py-2"
                            >
                                <span
                                    className="h-2 w-2 shrink-0 rounded-full"
                                    style={{ backgroundColor: item.color }}
                                />
                                <span className="truncate text-[11px] font-bold">{item.name}</span>
                                <span
                                    className={`ml-auto shrink-0 text-xs font-bold tabular-nums ${item.amount >= 0
                                        ? "text-green-600 dark:text-green-400"
                                        : "text-red-500"}`}
                                >
                                    {formatSignedAmount(item.amount)}
                                    <span className="ml-0.5 text-[9px] opacity-70">円</span>
                                </span>
                                {canRegisterTransaction && item.categoryId != null && (
                                    <Link
                                        href={transactionHref(item.categoryId, item.amount)}
                                        className="shrink-0 rounded-md border p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                                        aria-label={`${item.name}の取引を登録する`}
                                        title="取引履歴に登録する"
                                    >
                                        <ArrowRight className="h-3 w-3" />
                                    </Link>
                                )}
                            </div>
                        ))}

                        <div className="mt-1 flex items-center justify-between rounded-md border border-dashed px-2.5 py-2 text-[10px] text-muted-foreground">
                            <span>実行後の最大のズレ</span>
                            <span className="tabular-nums">
                                <b className="text-xs text-foreground">{proposal.maxDriftBefore.toFixed(1)}pt</b>
                                <span className="mx-1">→</span>
                                <b className="text-xs text-green-600 dark:text-green-400">
                                    {proposal.maxDriftAfter.toFixed(1)}pt
                                </b>
                            </span>
                        </div>

                        {mode === "buySell" && (
                            <div className="flex items-center justify-between px-1 text-[10px] text-muted-foreground">
                                <span>
                                    売り <b className="tabular-nums text-red-500">{formatAmount(proposal.sellTotal)}</b>円
                                </span>
                                <span>
                                    買い <b className="tabular-nums text-green-600 dark:text-green-400">{formatAmount(proposal.buyTotal)}</b>円
                                </span>
                            </div>
                        )}

                        {mode === "buyOnly" && proposal.maxDriftAfter >= 0.05 && (
                            <p className="rounded-md bg-muted/60 px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground">
                                買い増しだけでは、目標より多い資産は減りません。目標ちょうどに合わせるなら「売買あり」を選んでください。
                            </p>
                        )}

                        {proposal.skippedCount > 0 && (
                            <p className="px-1 text-[10px] text-muted-foreground">
                                金額が1,000円未満になる{proposal.skippedCount}件は「変更しない」に寄せています。
                            </p>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
