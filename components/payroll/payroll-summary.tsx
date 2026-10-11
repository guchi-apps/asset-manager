"use client"

import { Banknote, CalendarDays, Gift, Wallet } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import type { BonusDTO, SalaryDTO } from "@/lib/payroll/types"

/**
 * 給与一覧の上部に出す、直近の年の支給額・手取額のまとめ（Issue #714）。
 * 年は支給日の年（暦年）で区切る。明細ラボの年別表示と同じ区切り。
 */
export function PayrollSummary({ salaries, bonuses }: { salaries: SalaryDTO[]; bonuses: BonusDTO[] }) {
    if (salaries.length === 0 && bonuses.length === 0) return null

    const latest = salaries[0]
    const year = new Date(latest?.salaryDate ?? bonuses[0].bonusDate).getFullYear()
    const yearSalaries = salaries.filter((s) => new Date(s.salaryDate).getFullYear() === year)
    const yearBonuses = bonuses.filter((b) => new Date(b.bonusDate).getFullYear() === year)
    const gross = yearSalaries.reduce((sum, s) => sum + Number(s.grossSalary), 0)
    const net = yearSalaries.reduce((sum, s) => sum + Number(s.netSalary), 0)
    const bonusGross = yearBonuses.reduce((sum, b) => sum + Number(b.amount), 0)
    const bonusNet = yearBonuses.reduce((sum, b) => sum + numberOf(b.data.netAmount), 0)

    return (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
            <Tile icon={<Banknote className="size-4" />} label={`${year}年 給与の支給額`} value={gross} note={`${yearSalaries.length}回分`} />
            <Tile
                icon={<Wallet className="size-4" />}
                label={`${year}年 給与の手取額`}
                value={net}
                note={gross > 0 ? `手取り率 ${((net / gross) * 100).toFixed(1)}%` : "—"}
            />
            <Tile
                icon={<CalendarDays className="size-4" />}
                label={latest ? `直近の手取額（${formatMonthDay(latest.salaryDate)}）` : "直近の手取額"}
                value={latest ? Number(latest.netSalary) : null}
                note={latest ? `支給額 ${Number(latest.grossSalary).toLocaleString()}円` : "給与の登録なし"}
            />
            <Tile
                icon={<Gift className="size-4" />}
                label={`${year}年 賞与の支給額`}
                value={bonusGross}
                note={`${yearBonuses.length}回 ・ 手取り ${bonusNet.toLocaleString()}円`}
            />
        </div>
    )
}

function numberOf(value: unknown): number {
    return typeof value === "number" ? value : 0
}

function formatMonthDay(iso: string): string {
    const date = new Date(iso)
    return `${date.getMonth() + 1}/${date.getDate()}`
}

function Tile({
    icon,
    label,
    value,
    note,
}: {
    icon: React.ReactNode
    label: string
    value: number | null
    note: string
}) {
    return (
        <Card className="gap-1 py-3">
            <CardContent className="flex min-w-0 flex-col gap-1 px-3 md:px-4">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {icon}
                    <span className="truncate">{label}</span>
                </div>
                <div className="flex items-baseline gap-1">
                    <span className="text-xs font-semibold text-muted-foreground md:text-sm">¥</span>
                    <span className="text-xl font-bold tracking-tight tabular-nums md:text-2xl">
                        {value === null ? "—" : value.toLocaleString()}
                    </span>
                </div>
                <span className="truncate text-xs text-muted-foreground">{note}</span>
            </CardContent>
        </Card>
    )
}

/**
 * 同じ年の税務画面への導線（Issue #714）。税務画面は年次税務の移管（#716）で作るため、
 * それまでは押せない表示にとどめる。#716 で遷移先ができたら Link に差し替える。
 */
export function TaxYearLink({ year }: { year: number }) {
    return (
        <span
            aria-disabled="true"
            title="税務の画面は準備中です"
            className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-dashed px-2.5 py-0.5 text-xs text-muted-foreground"
        >
            {year}年の税務（準備中）
        </span>
    )
}
