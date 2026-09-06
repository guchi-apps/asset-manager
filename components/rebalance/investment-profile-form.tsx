"use client"

import * as React from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { saveInvestmentProfile } from "@/app/actions/investment-profile"
import {
    ageFromBirthYear,
    hasInvestmentProfile,
    RISK_TOLERANCES,
    RISK_TOLERANCE_LABELS,
    type InvestmentProfile,
    type RiskTolerance,
} from "@/lib/rebalance-advice"
import { formatAmount } from "@/components/rebalance/format"

interface InvestmentProfileFormProps {
    profile: InvestmentProfile
    /** 積立自動登録（有効分）の毎月の合計。未登録は null */
    monthlyDeposit: number | null
    onSaved: (profile: InvestmentProfile) => void
}

function toInputValue(value: number | null): string {
    return value == null ? "" : String(value)
}

function parseIntegerInput(value: string): number | null {
    const trimmed = value.trim()
    if (!trimmed) return null
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : NaN
}

/**
 * AIカードの先頭に置く投資プロフィール。保存済みならチップで要約し、「編集」で入力欄に切り替える。
 * まだ何も登録していないときは最初から入力欄を出す（配分の提案が一般論になるのを防ぐため）。
 */
export function InvestmentProfileForm({ profile, monthlyDeposit, onSaved }: InvestmentProfileFormProps) {
    const [editing, setEditing] = React.useState(() => !hasInvestmentProfile(profile))
    const [birthYear, setBirthYear] = React.useState(toInputValue(profile.birthYear))
    const [retirementAge, setRetirementAge] = React.useState(toInputValue(profile.retirementAge))
    const [riskTolerance, setRiskTolerance] = React.useState<RiskTolerance | null>(profile.riskTolerance)
    const [note, setNote] = React.useState(profile.investmentNote ?? "")
    const [isSaving, setIsSaving] = React.useState(false)

    const startEditing = () => {
        setBirthYear(toInputValue(profile.birthYear))
        setRetirementAge(toInputValue(profile.retirementAge))
        setRiskTolerance(profile.riskTolerance)
        setNote(profile.investmentNote ?? "")
        setEditing(true)
    }

    const handleSave = async () => {
        const birth = parseIntegerInput(birthYear)
        const retire = parseIntegerInput(retirementAge)
        if (Number.isNaN(birth) || Number.isNaN(retire)) {
            toast.error("生年・リタイア予定年齢は数字で入力してください")
            return
        }
        setIsSaving(true)
        try {
            const result = await saveInvestmentProfile({
                birthYear: birth,
                retirementAge: retire,
                riskTolerance,
                investmentNote: note,
            })
            if (!result.success) {
                toast.error(result.error)
                return
            }
            toast.success("投資プロフィールを保存しました")
            setEditing(false)
            onSaved(result.profile)
        } finally {
            setIsSaving(false)
        }
    }

    const age = ageFromBirthYear(profile.birthYear)
    const yearsToRetire =
        age != null && profile.retirementAge != null ? Math.max(0, profile.retirementAge - age) : null
    const depositChip =
        monthlyDeposit != null && monthlyDeposit > 0
            ? `積立 月${formatAmount(monthlyDeposit)}円（積立設定から）`
            : "積立の登録なし"

    if (!editing) {
        return (
            <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-dashed px-2.5 py-2">
                <span className="w-full text-[10px] font-bold text-muted-foreground">
                    投資プロフィール（保存済み。配分の提案に使います）
                </span>
                {profile.birthYear != null && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold">
                        {profile.birthYear}年生まれ{age != null ? `（${age}歳）` : ""}
                    </span>
                )}
                {profile.retirementAge != null && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold">
                        リタイア予定 {profile.retirementAge}歳{yearsToRetire != null ? `（あと${yearsToRetire}年）` : ""}
                    </span>
                )}
                {profile.riskTolerance && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold">
                        リスク許容度 {RISK_TOLERANCE_LABELS[profile.riskTolerance]}
                    </span>
                )}
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold">{depositChip}</span>
                {profile.investmentNote && (
                    <span
                        className="max-w-full truncate rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold"
                        title={profile.investmentNote}
                    >
                        補足: {profile.investmentNote}
                    </span>
                )}
                <button
                    type="button"
                    onClick={startEditing}
                    className="ml-auto text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                    編集
                </button>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-2 rounded-md border border-dashed px-2.5 py-2">
            <span className="text-[10px] font-bold text-muted-foreground">
                投資プロフィール（任意。保存すると次回から入力不要）
            </span>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold text-muted-foreground">生年</span>
                    <Input
                        type="text"
                        inputMode="numeric"
                        value={birthYear}
                        onChange={(e) => setBirthYear(e.target.value.replace(/[^\d]/g, ""))}
                        placeholder="例: 1981"
                        className="h-8 text-xs tabular-nums"
                    />
                </label>
                <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold text-muted-foreground">リタイア予定年齢</span>
                    <Input
                        type="text"
                        inputMode="numeric"
                        value={retirementAge}
                        onChange={(e) => setRetirementAge(e.target.value.replace(/[^\d]/g, ""))}
                        placeholder="例: 65"
                        className="h-8 text-xs tabular-nums"
                    />
                </label>
                <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold text-muted-foreground">リスク許容度</span>
                    <div className="flex h-8 w-fit gap-0.5 rounded-md border bg-muted/50 p-0.5">
                        {RISK_TOLERANCES.map((value) => (
                            <button
                                key={value}
                                type="button"
                                onClick={() => setRiskTolerance(riskTolerance === value ? null : value)}
                                aria-pressed={riskTolerance === value}
                                className={`rounded-md px-2.5 text-[11px] font-bold transition-all ${riskTolerance === value
                                    ? "bg-background text-foreground shadow-sm"
                                    : "text-muted-foreground hover:text-foreground"}`}
                            >
                                {RISK_TOLERANCE_LABELS[value]}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold text-muted-foreground">毎月の積立</span>
                    <span className="flex h-8 items-center text-[11px] text-muted-foreground">{depositChip}</span>
                </div>
                <label className="col-span-2 flex flex-col gap-1 md:col-span-4">
                    <span className="text-[10px] font-bold text-muted-foreground">補足（任意）</span>
                    <Input
                        type="text"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="例: 10年後に住宅購入で500万円使う予定"
                        maxLength={500}
                        className="h-8 text-xs"
                    />
                </label>
            </div>
            <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground">
                    年齢とリタイアまでの年数、リスク許容度から配分を提案します。積立額は「積立設定」の値を使います。
                </span>
                <div className="ml-auto flex shrink-0 gap-1.5">
                    {hasInvestmentProfile(profile) && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 text-[10px]"
                            onClick={() => setEditing(false)}
                            disabled={isSaving}
                        >
                            キャンセル
                        </Button>
                    )}
                    <Button type="button" size="sm" className="h-7 text-[10px]" onClick={handleSave} disabled={isSaving}>
                        保存
                    </Button>
                </div>
            </div>
        </div>
    )
}
