"use client"

import * as React from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { RowGroup } from "@/components/ledger/field-row"
import { formatDayHeading, formatYen } from "@/components/ledger/format"
import { getMergeCandidatesAction, mergeEntriesToTransferAction } from "@/app/actions/ledger"
import { LEDGER_ENTRY_KIND_LABELS } from "@/lib/ledger-input"
import type { MergeCandidateView } from "@/lib/ledger-service"
import { cn } from "@/lib/utils"

function accountsLabel(c: MergeCandidateView): string {
    if (c.kind === "TRANSFER") return `${c.fromAccountName ?? "口座未定"} → ${c.toAccountName ?? "口座未定"}`
    return (c.kind === "INCOME" ? c.toAccountName : c.fromAccountName) ?? "口座未定"
}

/**
 * 収入・支出の編集で、相手の取引と1件の振替にまとめる欄（#1368）。
 * 同額・日付の近い候補が無いときは何も出さない
 */
export function MergeTransferPanel({
    entryId,
    entryKind,
    accountName,
    disabled,
    onMerged,
}: {
    entryId: number
    entryKind: "INCOME" | "EXPENSE"
    /** 編集中の取引の入金先（収入）・出金元（支出）の口座名 */
    accountName: string | null
    disabled: boolean
    onMerged: () => void
}) {
    const [candidates, setCandidates] = React.useState<MergeCandidateView[]>([])
    const [selectedId, setSelectedId] = React.useState<number | null>(null)
    const [merging, setMerging] = React.useState(false)

    React.useEffect(() => {
        let cancelled = false
        setSelectedId(null)
        void getMergeCandidatesAction(entryId).then(
            (list) => {
                if (!cancelled) setCandidates(list)
            },
            () => {
                if (!cancelled) setCandidates([])
            }
        )
        return () => {
            cancelled = true
        }
    }, [entryId])

    if (candidates.length === 0) return null
    const selected = candidates.find((c) => c.id === selectedId) ?? null

    const preview = (() => {
        if (!selected) return null
        const from = entryKind === "INCOME" ? selected.fromAccountName : accountName
        const to = entryKind === "INCOME" ? accountName : selected.toAccountName
        const removed = selected.kind === "TRANSFER" ? "この収入は消えます" : "2件が1件の振替になります"
        return `振替 ${from ?? "口座未定"} → ${to ?? "口座未定"} ${formatYen(selected.amount)}。${removed}`
    })()

    const handleMerge = async () => {
        if (!selected) return
        setMerging(true)
        try {
            const result = await mergeEntriesToTransferAction(entryId, selected.id)
            if (!result.success) {
                toast.error(result.error)
                return
            }
            toast.success("1件の振替にまとめました")
            onMerged()
        } finally {
            setMerging(false)
        }
    }

    return (
        <div className="flex flex-col gap-2">
            <p className="px-1 text-[13px] font-medium sm:text-sm">取引とまとめる（振替にする）</p>
            <RowGroup>
                <ul role="radiogroup" aria-label="まとめる取引" className="flex flex-col">
                    {candidates.map((c) => {
                        const checked = c.id === selectedId
                        return (
                            <li key={c.id} className="border-b last:border-b-0">
                                <button
                                    type="button"
                                    role="radio"
                                    aria-checked={checked}
                                    id={`ledger-merge-candidate-${c.id}`}
                                    onClick={() => setSelectedId(checked ? null : c.id)}
                                    className={cn(
                                        "flex w-full items-start gap-3 px-4 py-2.5 text-left outline-none focus-visible:bg-accent sm:px-3.5",
                                        checked && "bg-primary/10"
                                    )}
                                >
                                    <span
                                        aria-hidden
                                        className={cn(
                                            "mt-0.5 size-4 shrink-0 rounded-full border-2 border-muted-foreground/60",
                                            checked && "border-primary bg-[radial-gradient(var(--primary)_40%,transparent_45%)]"
                                        )}
                                    />
                                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                        <span className="text-[13px] sm:text-sm">
                                            {formatDayHeading(c.date)} {LEDGER_ENTRY_KIND_LABELS[c.kind]}{" "}
                                            <span className="tabular-nums">{formatYen(c.amount)}</span>
                                            {c.excludeFromTotals && (
                                                <span className="ml-1.5 rounded-full border px-1.5 text-[10.5px] text-muted-foreground">集計に含めない</span>
                                            )}
                                        </span>
                                        <span className="truncate text-[11px] leading-snug text-muted-foreground sm:text-xs">
                                            {[accountsLabel(c), c.place, c.imported ? "取り込み" : "手入力"].filter(Boolean).join(" ・ ")}
                                        </span>
                                    </span>
                                </button>
                            </li>
                        )
                    })}
                </ul>
            </RowGroup>
            <p className="px-1 text-[11px] leading-snug text-muted-foreground sm:text-xs">
                {preview ??
                    (entryKind === "INCOME"
                        ? "現金を受け取って同じ額を別の口座から払ったときや、取り込んだ振替と二重になっているときに、1件の振替へまとめます。"
                        : "受け取った収入と同じ額をこの支出で払ったときに、1件の振替へまとめます。")}
            </p>
            <Button type="button" variant="outline" id="ledger-merge-submit" onClick={handleMerge} disabled={disabled || merging || !selected} className="h-11">
                まとめる
            </Button>
        </div>
    )
}
