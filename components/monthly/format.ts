import type { PayPeriod } from "@/lib/pay-period"

export const formatYen = (value: number) =>
    new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(Math.round(value))

export const formatSignedYen = (value: number) => {
    if (Math.round(value) === 0) return "±0"
    return `${value > 0 ? "+" : "−"}${formatYen(Math.abs(value))}`
}

export const gainClass = (value: number | null) => {
    if (value == null || Math.round(value) === 0) return "text-foreground"
    return value > 0 ? "text-green-600 dark:text-green-400" : "text-red-500"
}

const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`

/** 例: 9/25〜10/23 */
export const formatPeriod = (period: PayPeriod) => `${md(period.start)}〜${md(period.end)}`
