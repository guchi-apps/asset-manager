import type { ModelSpec, NormalizedRow } from "./models"

/**
 * 移行元と移行先を、ユーザー×モデル×年で突き合わせる（Issue #717）。
 *
 * 件数は「有効」と「削除済み」（`deletedAt` あり）を分けて数え、金額は最小単位（×100 の整数）で合計する。
 * Decimal を浮動小数点で足すと誤差が出るため。
 */

// tsconfig の target が ES2020 未満のため BigInt リテラル（100n）は使えない
const ZERO = BigInt(0)
const HUNDRED = BigInt(100)

export type Totals = {
    count: number
    deletedCount: number
    /** 列名 → 最小単位の合計（BigInt を文字列にしたもの）。削除済みの行は含めない */
    amounts: Record<string, string>
}

export type YearTotals = Map<string, Totals>

const emptyTotals = (spec: ModelSpec): Totals => ({
    count: 0,
    deletedCount: 0,
    amounts: Object.fromEntries(spec.amountFields.map((name) => [name, "0"])),
})

/** "-12000.50" → -1200050n（小数点以下2桁にそろえた値が前提） */
export function toMinorUnits(value: unknown): bigint {
    const text = String(value)
    const match = /^(-?)(\d+)\.(\d{2})$/.exec(text)
    if (!match) throw new Error(`金額の形式が想定外です: ${text}`)
    const [, sign, int, frac] = match
    const abs = BigInt(int) * HUNDRED + BigInt(frac)
    return sign === "-" ? -abs : abs
}

export function totalsByYear(spec: ModelSpec, rows: NormalizedRow[]): YearTotals {
    const result: YearTotals = new Map()
    for (const row of rows) {
        const year = spec.yearOf?.(row.fields)
        const key = year === null || year === undefined ? "-" : String(year)
        const totals = result.get(key) ?? emptyTotals(spec)
        if (row.fields.deletedAt) {
            totals.deletedCount += 1
        } else {
            totals.count += 1
            for (const name of spec.amountFields) {
                totals.amounts[name] = (BigInt(totals.amounts[name]) + toMinorUnits(row.fields[name])).toString()
            }
        }
        result.set(key, totals)
    }
    return result
}

export type TotalsDiff = {
    year: string
    source: Totals
    target: Totals
}

/** 年ごとの合計が食い違うものだけを返す（空なら一致）。 */
export function diffTotals(spec: ModelSpec, source: YearTotals, target: YearTotals): TotalsDiff[] {
    const years = [...new Set([...source.keys(), ...target.keys()])].sort()
    const diffs: TotalsDiff[] = []
    for (const year of years) {
        const s = source.get(year) ?? emptyTotals(spec)
        const t = target.get(year) ?? emptyTotals(spec)
        const same =
            s.count === t.count &&
            s.deletedCount === t.deletedCount &&
            spec.amountFields.every((name) => s.amounts[name] === t.amounts[name])
        if (!same) diffs.push({ year, source: s, target: t })
    }
    return diffs
}

/** 最小単位の合計を "1,234,567.89" の形にする（表示用）。 */
export function formatMinorUnits(value: string): string {
    const n = BigInt(value)
    const negative = n < ZERO
    const abs = negative ? -n : n
    const int = (abs / HUNDRED).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")
    const frac = (abs % HUNDRED).toString().padStart(2, "0")
    return `${negative ? "-" : ""}${int}.${frac}`
}

export function formatTotals(spec: ModelSpec, totals: Totals): string {
    const amounts = spec.amountFields.map((name) => `${name}=${formatMinorUnits(totals.amounts[name])}`)
    return [`有効${totals.count}件`, `削除済み${totals.deletedCount}件`, ...amounts].join(" ")
}
