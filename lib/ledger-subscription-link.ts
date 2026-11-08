import {
    compareDayKey,
    daysBetween,
    getCurrentPrice,
    getLastOccurrence,
    getNextOccurrence,
    type Currency,
    type DayKey,
    type PriceEntry,
} from "@/lib/subscription-billing"
import { EMAIL_DATE_TOLERANCE_DAYS, NEAR_AMOUNT_RATIO, WIDE_DATE_TOLERANCE_DAYS } from "@/lib/ledger-match"

/**
 * 家計簿の取引に、サブスク（契約）を紐付ける候補の選び方（Issue #946）。
 * DBに触らない純粋な関数だけを置く。紐付け・解除・「違う」の保存は `lib/ledger-subscription-service.ts`。
 *
 * 紐付けは印を付けるだけで、取引の金額・日付・品目は変えない。
 */

export interface SubscriptionLinkEntry {
    date: DayKey
    amount: number
    /** 取引の相手先・品目名。サブスクの名前と照らす */
    names: string[]
}

export interface SubscriptionLinkSource {
    id: number
    name: string
    startDate: DayKey
    endDate: DayKey | null
    prices: Array<PriceEntry & { planName: string | null }>
}

export interface SubscriptionLinkStrength {
    /** 取引の日に有効な料金と同じ額（円建てのみ。ドル建ては比べられないので常に false） */
    sameAmount: boolean
    /** 料金の ±`NEAR_AMOUNT_RATIO` の中（円建てのみ） */
    nearAmount: boolean
    /** いちばん近い支払い予定日との日数の差。支払い予定日が見つからなければ null */
    dayGap: number | null
    /** サブスクの名前が、取引の相手先・品目名に含まれる（逆でも可） */
    nameMatch: boolean
}

export interface SubscriptionLinkCandidate {
    id: number
    strength: SubscriptionLinkStrength
    /** 取引の日に有効な料金 */
    price: PriceEntry & { planName: string | null }
}

/** 照合のために名前をそろえる（全角半角・大小文字・空白・記号を無視する） */
export function normalizeName(value: string): string {
    return value
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[\s　・･\-_.,、。()（）「」『』【】[\]/／*＊]/g, "")
}

/** 「Netflix（プレミアム）」のようにプランを括弧で添えた名前は、括弧の前だけも照合に使う */
function nameKeys(name: string): string[] {
    const keys = new Set<string>()
    const full = normalizeName(name)
    if (full.length >= 2) keys.add(full)
    const head = normalizeName(name.split(/[（(]/)[0] ?? "")
    if (head.length >= 2) keys.add(head)
    return [...keys]
}

export function namesMatch(subscriptionName: string, entryNames: string[]): boolean {
    const keys = nameKeys(subscriptionName)
    if (keys.length === 0) return false
    return entryNames.some((raw) => {
        const target = normalizeName(raw)
        if (target.length < 2) return false
        return keys.some((key) => target.includes(key) || key.includes(target))
    })
}

/** その日の前後で、いちばん近い支払い予定日との日数の差 */
export function nearestBillingGap(source: SubscriptionLinkSource, day: DayKey): number | null {
    const occurrenceSource = { startDate: source.startDate, endDate: source.endDate, prices: source.prices }
    const last = getLastOccurrence(occurrenceSource, day)
    const next = getNextOccurrence(occurrenceSource, day)
    const gaps = [last ? daysBetween(last.day, day) : null, next ? daysBetween(day, next.day) : null].filter((g): g is number => g !== null)
    return gaps.length === 0 ? null : Math.min(...gaps)
}

/** 取引の日にその契約が続いていたか。始まる前・終わった後でも、候補の日付の幅の分は見逃さない */
function isActiveAround(source: SubscriptionLinkSource, day: DayKey, slackDays: number): boolean {
    if (compareDayKey(source.startDate, day) > 0 && daysBetween(day, source.startDate) > slackDays) return false
    if (source.endDate !== null && compareDayKey(source.endDate, day) < 0 && daysBetween(source.endDate, day) > slackDays) return false
    return true
}

export function evaluateSubscription(entry: SubscriptionLinkEntry, source: SubscriptionLinkSource): SubscriptionLinkCandidate | null {
    if (source.prices.length === 0) return null
    const price = getCurrentPrice(source.prices, entry.date)
    const comparable = (price.currency as Currency) === "JPY"
    const diff = Math.abs(Math.round(price.amount) - entry.amount)
    return {
        id: source.id,
        price,
        strength: {
            sameAmount: comparable && diff === 0,
            nearAmount: comparable && diff <= Math.abs(price.amount) * NEAR_AMOUNT_RATIO,
            dayGap: nearestBillingGap(source, entry.date),
            nameMatch: namesMatch(source.name, entry.names),
        },
    }
}

/** 並べる順の点数。大きいほど上 */
function scoreOf(s: SubscriptionLinkStrength): number {
    return (s.sameAmount ? 4 : s.nearAmount ? 1 : 0) + (s.nameMatch ? 2 : 0) + (s.dayGap === 0 ? 1 : 0)
}

export interface SubscriptionImportEntry extends SubscriptionLinkEntry {
    id: number
}

export interface SubscriptionImportCandidate {
    id: number
    strength: SubscriptionLinkStrength
}

/**
 * 1つの定期払いに付けられそうな取引を絞って、新しい順に返す（Issue #1220。`pickSubscriptionCandidates` の逆引き）。
 * 条件は `wide` と同じ（前後 `WIDE_DATE_TOLERANCE_DAYS` 日以内で、金額が同じ・近い・名前が近いのどれか）。
 */
export function pickImportCandidates(source: SubscriptionLinkSource, entries: SubscriptionImportEntry[]): SubscriptionImportCandidate[] {
    const picked: Array<SubscriptionImportCandidate & { date: DayKey }> = []
    for (const entry of entries) {
        if (!isActiveAround(source, entry.date, WIDE_DATE_TOLERANCE_DAYS)) continue
        const candidate = evaluateSubscription(entry, source)
        if (!candidate) continue
        const { sameAmount, nearAmount, dayGap, nameMatch } = candidate.strength
        if (dayGap === null || dayGap > WIDE_DATE_TOLERANCE_DAYS) continue
        if (sameAmount || nearAmount || nameMatch) picked.push({ id: entry.id, strength: candidate.strength, date: entry.date })
    }
    return picked
        .sort((a, b) => compareDayKey(b.date, a.date) || b.id - a.id)
        .map(({ id, strength }) => ({ id, strength }))
}

/**
 * 取引に付けられそうなサブスクを絞って、確からしい順に返す。
 * - 既定: 支払い予定日が前後 `EMAIL_DATE_TOLERANCE_DAYS` 日以内で、金額が同じ（名前が近ければ金額が近いだけでもよい）
 * - `wide`: 前後 `WIDE_DATE_TOLERANCE_DAYS` 日以内で、金額が同じ・近い・名前が近いのどれか
 * `rejected` は人が「違う」を押した契約の id で、候補に出さない。
 */
export function pickSubscriptionCandidates(
    entry: SubscriptionLinkEntry,
    sources: SubscriptionLinkSource[],
    rejected: number[],
    wide: boolean
): SubscriptionLinkCandidate[] {
    const days = wide ? WIDE_DATE_TOLERANCE_DAYS : EMAIL_DATE_TOLERANCE_DAYS
    const skip = new Set(rejected)
    const picked: SubscriptionLinkCandidate[] = []
    for (const source of sources) {
        if (skip.has(source.id) || !isActiveAround(source, entry.date, days)) continue
        const candidate = evaluateSubscription(entry, source)
        if (!candidate) continue
        const { sameAmount, nearAmount, dayGap, nameMatch } = candidate.strength
        if (dayGap === null || dayGap > days) continue
        const amountOk = wide ? sameAmount || nearAmount || nameMatch : sameAmount || (nameMatch && nearAmount)
        if (amountOk) picked.push(candidate)
    }
    return picked.sort((a, b) => scoreOf(b.strength) - scoreOf(a.strength) || (a.strength.dayGap ?? 99) - (b.strength.dayGap ?? 99) || a.id - b.id)
}
