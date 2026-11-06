"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronLeft } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { formatDayHeading, formatYen } from "@/components/ledger/format"
import { SettlementDialog, type SettlementDraft } from "@/components/ledger/settlement-dialog"
import { isSettled, type CounterpartyBalance, type DebtItemView, type SettlementItem } from "@/lib/ledger-advances"
import type { LedgerDebtPageData } from "@/lib/ledger-service"
import { cn } from "@/lib/utils"

const LEND = "text-teal-700 dark:text-teal-400"
const OWE = "text-amber-700 dark:text-amber-400"

/**
 * 立て替え・後払いの画面（Issue #880）。上に貸し・借りの合計、下に人ごとの残りと内訳を並べる。
 * 回収・支払いは古い順に充てる（`lib/ledger-advances.ts`）。精算済みの人は下にたたむ。
 */
export function AdvancesContent({ data }: { data: LedgerDebtPageData }) {
    const router = useRouter()
    const [draft, setDraft] = React.useState<SettlementDraft | null>(null)
    const [remaining, setRemaining] = React.useState<number | undefined>(undefined)
    const [open, setOpen] = React.useState(false)

    const openPeople = data.people.filter((p) => !isSettled(p))
    const settledPeople = data.people.filter(isSettled)

    const startSettlement = (person: CounterpartyBalance, direction: "collect" | "pay") => {
        const rest = direction === "collect" ? person.lent : person.borrowed
        setDraft({
            direction,
            counterparty: person.name,
            date: data.today,
            amount: Math.max(0, rest),
            accountId: defaultAccountId(data),
            memo: null,
        })
        setRemaining(rest)
        setOpen(true)
    }

    const editSettlement = (person: CounterpartyBalance, item: SettlementItem) => {
        setDraft({
            id: item.entryId,
            direction: item.direction,
            counterparty: person.name,
            date: item.date,
            amount: item.amount,
            accountId: item.accountId,
            memo: item.memo,
        })
        setRemaining(undefined)
        setOpen(true)
    }

    return (
        <div className="flex flex-col gap-4 px-1 pt-4 md:px-2">
            <div className="flex flex-col gap-1">
                <div>
                    <Button asChild variant="ghost" size="sm" className="-ml-2">
                        <Link href="/ledger">
                            <ChevronLeft />
                            家計簿
                        </Link>
                    </Button>
                </div>
                <h1 className="text-lg font-semibold">立て替え・後払い</h1>
                <p className="text-xs text-muted-foreground">
                    立て替えた分は自分の支出に入れず、ここで「貸し」として追います。回収したお金は収入に入れず、受け取った口座の残高だけが増えます。
                </p>
            </div>

            <div className="grid grid-cols-2 gap-2 md:gap-3">
                <Card className="gap-1 py-3">
                    <CardContent className="flex flex-col gap-0.5 px-3">
                        <span className="text-xs text-muted-foreground">貸し（未回収）</span>
                        <span className={cn("text-lg font-semibold tabular-nums", LEND)}>{formatYen(data.overview.lentTotal)}</span>
                        <span className="text-xs text-muted-foreground">{data.overview.lentPeople}人・立て替えて、まだ受け取っていない</span>
                    </CardContent>
                </Card>
                <Card className="gap-1 py-3">
                    <CardContent className="flex flex-col gap-0.5 px-3">
                        <span className="text-xs text-muted-foreground">借り（未払い）</span>
                        <span className={cn("text-lg font-semibold tabular-nums", OWE)}>{formatYen(data.overview.borrowedTotal)}</span>
                        <span className="text-xs text-muted-foreground">{data.overview.borrowedPeople}人・払ってもらって、まだ返していない</span>
                    </CardContent>
                </Card>
            </div>

            {openPeople.length === 0 ? (
                <Card>
                    <CardContent className="py-6 text-sm text-muted-foreground">
                        残っている貸し・借りはありません。取引を追加するときに「立て替えた分がある」をオンにするか、支払い口座で「後払い（あとで払う）」を選ぶと、ここに出ます。
                    </CardContent>
                </Card>
            ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {openPeople.map((person) => (
                        <PersonCard
                            key={person.name}
                            person={person}
                            onSettle={(direction) => startSettlement(person, direction)}
                            onEditSettlement={(item) => editSettlement(person, item)}
                        />
                    ))}
                </div>
            )}

            {settledPeople.length > 0 && (
                <details className="rounded-xl border bg-card px-3.5 py-2.5">
                    <summary className="cursor-pointer text-sm font-semibold">精算済み（{settledPeople.length}人）</summary>
                    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                        {settledPeople.map((person) => (
                            <PersonCard key={person.name} person={person} onEditSettlement={(item) => editSettlement(person, item)} />
                        ))}
                    </div>
                </details>
            )}

            <SettlementDialog
                open={open}
                onOpenChange={setOpen}
                draft={draft}
                remaining={remaining}
                accounts={data.accounts}
                onSaved={() => router.refresh()}
            />
        </div>
    )
}

/** 回収・支払いとも現金を既定にする（無ければ先頭の口座） */
function defaultAccountId(data: LedgerDebtPageData): number | null {
    const visible = data.accounts.filter((a) => !a.hidden)
    return (visible.find((a) => a.kind === "CASH") ?? visible[0])?.id ?? null
}

function PersonCard({
    person,
    onSettle,
    onEditSettlement,
}: {
    person: CounterpartyBalance
    onSettle?: (direction: "collect" | "pay") => void
    onEditSettlement: (item: SettlementItem) => void
}) {
    const both = person.lentItems.length > 0 && person.borrowedItems.length > 0
    const net = person.lent - person.borrowed
    return (
        <Card className="gap-2 py-3">
            <CardContent className="flex flex-col gap-2 px-3.5">
                <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 break-words text-base font-semibold">{person.name}</span>
                    <div className="flex shrink-0 flex-col items-end gap-0.5">
                        {(person.lentItems.length > 0 || person.lent !== 0) && (
                            <Balance label={person.lent < 0 ? "受け取りすぎ" : "貸し（未回収）"} value={Math.abs(person.lent)} className={LEND} />
                        )}
                        {(person.borrowedItems.length > 0 || person.borrowed !== 0) && (
                            <Balance label={person.borrowed < 0 ? "払いすぎ" : "借り（未払い）"} value={Math.abs(person.borrowed)} className={OWE} />
                        )}
                    </div>
                </div>
                {both && net !== 0 && (person.lent > 0 || person.borrowed > 0) && (
                    <p className="text-xs text-muted-foreground">
                        差し引きすると {net > 0 ? `${formatYen(net)} を受け取る` : `${formatYen(-net)} を払う`}側です
                    </p>
                )}
                <div className="flex flex-col divide-y border-t text-xs">
                    {person.lentItems.map((item) => (
                        <ItemRow key={`l${item.entryId}`} item={item} label="立て替え" />
                    ))}
                    {person.borrowedItems.map((item) => (
                        <ItemRow key={`b${item.entryId}`} item={item} label="後払い" />
                    ))}
                    {person.settlements.map((s) => (
                        <button
                            key={`s${s.entryId}`}
                            type="button"
                            onClick={() => onEditSettlement(s)}
                            className="grid grid-cols-[4.5em_minmax(0,1fr)_auto] items-center gap-2 py-1.5 text-left text-muted-foreground hover:bg-accent/50"
                        >
                            <span>{formatDayHeading(s.date)}</span>
                            <span className="truncate">
                                {s.direction === "collect" ? "回収" : "支払い"}
                                {s.accountName ? ` ${s.direction === "collect" ? "＞" : "＜"} ${s.accountName}` : ""}
                            </span>
                            <span className="tabular-nums">−{formatYen(s.amount)}</span>
                        </button>
                    ))}
                </div>
                {onSettle && (
                    <div className="flex flex-wrap justify-end gap-2">
                        {person.lent > 0 && (
                            <Button size="sm" onClick={() => onSettle("collect")}>
                                回収を記録
                            </Button>
                        )}
                        {person.borrowed > 0 && (
                            <Button size="sm" variant={person.lent > 0 ? "outline" : "default"} onClick={() => onSettle("pay")}>
                                支払いを記録
                            </Button>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    )
}

function Balance({ label, value, className }: { label: string; value: number; className: string }) {
    return (
        <span className="flex items-baseline gap-1.5">
            <span className="text-[11px] text-muted-foreground">{label}</span>
            <span className={cn("text-lg font-semibold tabular-nums", className)}>{formatYen(value)}</span>
        </span>
    )
}

function ItemRow({ item, label }: { item: DebtItemView; label: string }) {
    const partial = item.remaining > 0 && item.remaining < item.amount
    return (
        <div className="grid grid-cols-[4.5em_minmax(0,1fr)_auto] items-center gap-2 py-1.5">
            <span className="text-muted-foreground">{formatDayHeading(item.date)}</span>
            <span className="truncate">
                <span className="text-muted-foreground">{label} · </span>
                {item.title}
            </span>
            <span className="flex flex-col items-end tabular-nums">
                {formatYen(item.amount)}
                <span className="text-[10.5px] text-muted-foreground">
                    {item.remaining === 0 ? "済み" : partial ? `残り ${formatYen(item.remaining)}` : "未"}
                </span>
            </span>
        </div>
    )
}
