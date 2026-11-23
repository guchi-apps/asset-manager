/**
 * PayPayポイントなど、利用額に応じて貯まるポイントの自動計算（純粋関数）。
 *
 * 家計簿の取引は増やさず、ポイント口座に結び付けた「貯まる元の口座」の確定した支出から、毎回計算して出す。
 * - 基本還元率（`rateBp`。0.5% = 50bp）。取引ごとに還元率を上書きでき、基本を超えた分は「ボーナス」として別の日数で付与する
 * - 付与までのラグ: 基本分は `baseLagDays`、ボーナス分は `bonusLagDays`（支払い日からの日数）。付与日を過ぎた分を「利用可能」、
 *   まだの分を「付与予定」に分ける
 * - 計算は1取引ごとに端数を切り捨てる（返金のマイナスは絶対値を切り捨てて引く）
 * - 取引の入力画面で付いたポイント数を入れた取引（Issue #1583）は、その数で上書きする。基本分を超えた分がボーナス
 * - 自動計算の無いポイント口座（Vポイントなど）の手入力のポイントは、支払い日に付与済みとして数える（`computeManualPointAccrual`）
 */
import { addDays } from "@/lib/jp-holidays"

export const POINT_RATE_BP_MAX = 10_000
export const POINT_LAG_DAYS_MAX = 365
/** 基本還元率の既定（0.5%） */
export const POINT_DEFAULT_RATE_BP = 50
/** 基本分の付与までの既定の日数。PayPayの公式ヘルプに記載が無いので口座ごとに直せる */
export const POINT_DEFAULT_BASE_LAG_DAYS = 1
/** ボーナス分の既定。PayPayは特典ポイントを「支払いの翌日から起算して30日後」に付与する（= 支払い日から31日後） */
export const POINT_DEFAULT_BONUS_LAG_DAYS = 31

export interface PointAccrualSettings {
    /** この日以降の支出だけを数える（それより前は手入力の残高に含まれている前提）。`YYYY-MM-DD` */
    startDate: string
    rateBp: number
    baseLagDays: number
    bonusLagDays: number
}

export interface PointAccrualEntry {
    id: number
    date: string
    /** 貯まる元の口座で払った金額（円。返金はマイナス） */
    amount: number
    /** この取引だけの還元率（bp）。null は基本還元率 */
    rateBp: number | null
    /** 取引の入力画面で入れた、この取引で付いたポイント数（#1583）。null・未指定なら還元率から計算する。`rateBp` より優先 */
    points?: number | null
}

export interface PointAccrualItem {
    entryId: number
    date: string
    base: number
    bonus: number
    baseAvailableOn: string
    bonusAvailableOn: string
}

export interface PointAccrual {
    /** 付与済み（利用可能）のポイント */
    granted: number
    /** 付与予定のポイント */
    pending: number
    /** 付与予定のうち、いちばん早い付与日。付与予定が無ければ null */
    nextAvailableOn: string | null
}

/** 金額 × 還元率（bp）を、絶対値で切り捨てる。返金はマイナスで返す */
export function pointsFor(amount: number, rateBp: number): number {
    const sign = amount < 0 ? -1 : 1
    return sign * Math.floor((Math.abs(amount) * rateBp) / 10_000)
}

/**
 * 取引ごとのポイント（基本分・ボーナス分）。上書きの還元率が基本以下なら、その率が基本分で、ボーナスは0。
 * ポイント数を入れた取引は、基本還元率で計算した分までを基本分、超えた分をボーナスにする（還元率の上書きと同じ分け方）
 */
export function accrualFor(entry: PointAccrualEntry, settings: PointAccrualSettings): PointAccrualItem {
    let base: number
    let total: number
    if (entry.points != null) {
        total = entry.points
        const baseFull = pointsFor(entry.amount, settings.rateBp)
        // 返金（マイナス）も同じ分け方で、基本で計算した分までが基本分
        base = total >= 0 ? Math.min(total, Math.max(baseFull, 0)) : Math.max(total, Math.min(baseFull, 0))
    } else {
        const effective = entry.rateBp === null ? settings.rateBp : entry.rateBp
        base = pointsFor(entry.amount, Math.min(effective, settings.rateBp))
        total = pointsFor(entry.amount, effective)
    }
    return {
        entryId: entry.id,
        date: entry.date,
        base,
        bonus: total - base,
        baseAvailableOn: addDays(entry.date, settings.baseLagDays),
        bonusAvailableOn: addDays(entry.date, settings.bonusLagDays),
    }
}

/** 開始日以降の取引から、`asOf` 時点の利用可能・付与予定を合計する。`asOf` の日に付与日を迎えるものは利用可能に入れる */
export function computePointAccrual(entries: readonly PointAccrualEntry[], settings: PointAccrualSettings, asOf: string): PointAccrual {
    let granted = 0
    let pending = 0
    let next: string | null = null
    const take = (points: number, availableOn: string, date: string) => {
        if (points === 0 || date > asOf) return
        if (availableOn <= asOf) {
            granted += points
            return
        }
        pending += points
        if (next === null || availableOn < next) next = availableOn
    }
    for (const entry of entries) {
        if (entry.date < settings.startDate) continue
        const item = accrualFor(entry, settings)
        take(item.base, item.baseAvailableOn, item.date)
        take(item.bonus, item.bonusAvailableOn, item.date)
    }
    return { granted, pending, nextAvailableOn: next }
}

/** 還元率の上書き（bp）を、その取引で付くポイント数へ換算する（#1583。入力画面を還元率からポイント数へ変えたため）。null は基本還元率 */
export function pointsFromRate(amount: number, rateBp: number | null, settings: Pick<PointAccrualSettings, "rateBp">): number {
    return pointsFor(amount, rateBp === null ? settings.rateBp : rateBp)
}

export interface ManualPointEarning {
    date: string
    points: number
}

/**
 * 自動計算の無いポイント口座（Vポイント・楽天ポイントなど）に、取引の入力画面で入れたポイント（#1583）。
 * 付与日の設定を持たないので、支払い日に付与済み（利用可能）として数える。`startDate` より前（初期残高の基準日より前）と、`asOf` より後は数えない
 */
export function computeManualPointAccrual(earnings: readonly ManualPointEarning[], startDate: string | null, asOf: string): PointAccrual {
    let granted = 0
    for (const e of earnings) {
        if (e.date > asOf || (startDate !== null && e.date < startDate)) continue
        granted += e.points
    }
    return { granted, pending: 0, nextAvailableOn: null }
}

