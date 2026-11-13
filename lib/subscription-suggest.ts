import { namesMatch, normalizeName } from "@/lib/ledger-subscription-link"
import { daysBetween, splitDayKey, type BillingCycle, type DayKey } from "@/lib/subscription-billing"

/**
 * 家計簿の明細から「定期払いかもしれない支払い」を見つける（Issue #1349）。DBに触らない純粋な関数だけを置く。
 * 読み出し・「定期払いではない」の保存は `lib/subscription-suggest-service.ts`。
 *
 * ## 見つけ方
 *
 * 1. 確定済みの支出を、お店の名前（`pickPaymentPlace`）をそろえたキーでまとめる
 * 2. 同じお店でも金額の違う契約（Appleの複数のサブスクなど）を分けるため、金額の近いものどうしで束ねる
 *    （最小の `SUGGEST_AMOUNT_SPREAD_RATIO` 倍まで。電気代のような変動はこの中に収める）
 * 3. 新しい明細から遡って、間隔が毎月（`MONTHLY_GAP`）または毎年（`YEARLY_GAP`）の範囲に収まり続ける並びを取る
 * 4. その並びが毎月なら `MONTHLY_MIN_COUNT` 回、毎年なら `YEARLY_MIN_COUNT` 回以上あり、最後の支払いから
 *    1周期＋猶予を過ぎていない（終わった契約ではない）ものを候補にする
 *
 * 月に何度も払うお店（スーパーなど）は間隔が短すぎて3.で途切れ、金額がばらばらなお店は2.で束がばらけるため候補にならない。
 */

/** 毎月とみなす明細の間隔（日）。月末・休日のずれと、28〜31日の月の長さの違いを含める */
export const MONTHLY_GAP = { min: 24, max: 38 } as const
/** 2か月ごととみなす明細の間隔（日）。水道料金のように2か月分をまとめて払うもの */
export const BIMONTHLY_GAP = { min: 54, max: 69 } as const
/** 毎年とみなす明細の間隔（日） */
export const YEARLY_GAP = { min: 345, max: 385 } as const
/** 毎月の候補にする最低回数 */
export const MONTHLY_MIN_COUNT = 3
/** 2か月ごとの候補にする最低回数 */
export const BIMONTHLY_MIN_COUNT = 3
/** 毎年の候補にする最低回数 */
export const YEARLY_MIN_COUNT = 2
/** 最後の支払いから、1周期にこの日数を足しても次が無ければ終わった契約とみなす */
export const SUGGEST_GRACE_DAYS = 14
/** 同じ契約の金額とみなす幅（束の最小額に対する最大額の倍率） */
export const SUGGEST_AMOUNT_SPREAD_RATIO = 1.4
/**
 * 金額が大きく動く請求（電気代の季節変動など）を、金額の束に分けずに1本の並びとして見るときの最低回数と、許す幅
 * （最小額に対する最大額の倍率）。幅を広げるぶん、偶然の並びを拾わないよう回数を多く求める
 */
export const VARIABLE_MIN_COUNT = 4
export const VARIABLE_AMOUNT_SPREAD_RATIO = 4
/** 判定に使う明細の期間（日）。毎年の候補を2回分見つけられるよう2年強を見る */
export const SUGGEST_LOOKBACK_DAYS = 760

export interface SuggestEntry {
    id: number
    date: DayKey
    amount: number
    /** お店の名前（`pickPaymentPlace`）。空なら候補にしない */
    name: string
    accountId: number | null
    accountName: string | null
}

export interface SuggestOccurrence {
    id: number
    date: DayKey
    amount: number
    accountName: string | null
}

export interface SubscriptionSuggestion {
    /** 「定期払いではない」で覚えるキー（お店の名前をそろえたもの） */
    key: string
    /** 画面の行のキー。同じお店に金額の違う候補が並ぶことがあるので `key` とは別に持つ */
    id: string
    /** 最新の明細のお店の名前 */
    name: string
    cycle: BillingCycle
    /** 何周期ごとか。毎月の候補は1（毎月）か2（2か月ごと）、毎年は1 */
    interval: number
    /** 登録フォームに入れる1回の金額。金額が一定ならその額、変動するなら中央値 */
    amount: number
    minAmount: number
    maxAmount: number
    /** すべての回で同じ金額か */
    fixedAmount: boolean
    /** 支払日（1〜31）。毎月はいちばん多い日、毎年は最新の日 */
    billingDay: number
    /** 毎年の支払い月（1〜12）。毎月は null */
    billingMonth: number | null
    /** 並びの最初の支払い日。登録フォームの契約開始日に入れる */
    startDate: DayKey
    lastDate: DayKey
    /** 最新の明細の口座 */
    accountId: number | null
    accountName: string | null
    /** 並びに入った明細（新しい順） */
    occurrences: SuggestOccurrence[]
    /** 月あたりの金額（並べ替え用） */
    monthlyAmount: number
}

export interface SuggestContext {
    today: DayKey
    /** 登録済みの定期払いの名前。名前が合うお店は候補にしない */
    subscriptionNames: string[]
    /** すでにどれかの定期払いに紐付いた明細のお店の名前。同じお店は候補にしない（登録名が明細の表記と違う場合に効く） */
    linkedNames: string[]
    /** 「定期払いではない」を押したキー */
    dismissedKeys: string[]
}

/** 「定期払いではない」を覚えるキー。お店の名前をそろえたもの（DBの列幅191文字まで）。2文字未満なら null（候補にしない） */
export function suggestionKey(name: string): string | null {
    const key = normalizeName(name).slice(0, 191)
    return key.length >= 2 ? key : null
}

/** 金額の近い明細どうしを束ねる。金額の小さい順に見て、束の最小額の `SUGGEST_AMOUNT_SPREAD_RATIO` 倍を超えたら次の束にする */
function clusterByAmount(entries: SuggestEntry[]): SuggestEntry[][] {
    const sorted = [...entries].sort((a, b) => a.amount - b.amount)
    const clusters: SuggestEntry[][] = []
    for (const entry of sorted) {
        const current = clusters[clusters.length - 1]
        if (current && entry.amount <= current[0].amount * SUGGEST_AMOUNT_SPREAD_RATIO) current.push(entry)
        else clusters.push([entry])
    }
    return clusters
}

/** 新しい明細から遡って、間隔が `gap` に収まり続ける並び（新しい順）。同じ日の重複は1件にする */
function latestRun(newestFirst: SuggestEntry[], gap: { min: number; max: number }): SuggestEntry[] {
    const run: SuggestEntry[] = []
    for (const entry of newestFirst) {
        const previous = run[run.length - 1]
        if (!previous) {
            run.push(entry)
            continue
        }
        const days = daysBetween(entry.date, previous.date)
        if (days < gap.min || days > gap.max) break
        run.push(entry)
    }
    return run
}

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

/** いちばん多く出てくる日。同数なら新しい明細の日を選ぶ（`newestFirst` の順で先に数えたもの） */
function modeDay(newestFirst: SuggestEntry[]): number {
    const counts = new Map<number, number>()
    for (const entry of newestFirst) {
        const day = splitDayKey(entry.date).date
        counts.set(day, (counts.get(day) ?? 0) + 1)
    }
    let best = splitDayKey(newestFirst[0].date).date
    for (const [day, count] of counts) {
        if (count > (counts.get(best) ?? 0)) best = day
    }
    return best
}

function buildSuggestion(
    key: string,
    index: number,
    run: SuggestEntry[],
    cycle: BillingCycle,
    interval: number
): SubscriptionSuggestion {
    const latest = run[0]
    const amounts = run.map((e) => e.amount)
    const minAmount = Math.min(...amounts)
    const maxAmount = Math.max(...amounts)
    const fixedAmount = minAmount === maxAmount
    const amount = fixedAmount ? latest.amount : median(amounts)
    const last = splitDayKey(latest.date)
    return {
        key,
        id: `${key}#${index}`,
        name: latest.name.trim(),
        cycle,
        interval,
        amount,
        minAmount,
        maxAmount,
        fixedAmount,
        billingDay: cycle === "MONTHLY" ? modeDay(run) : last.date,
        billingMonth: cycle === "YEARLY" ? last.month : null,
        startDate: run[run.length - 1].date,
        lastDate: latest.date,
        accountId: latest.accountId,
        accountName: latest.accountName,
        occurrences: run.map((e) => ({ id: e.id, date: e.date, amount: e.amount, accountName: e.accountName })),
        monthlyAmount: cycle === "MONTHLY" ? Math.round(amount / interval) : Math.round(amount / 12),
    }
}

/**
 * 束の中から候補を1つ作る。毎月 → 2か月ごと → 毎年の順に試し、当てはまったものを返す。
 * `wide` は金額の束に分けずに並びを見るとき（電気代のような大きな変動）で、回数を多く求める。
 */
function detect(key: string, index: number, cluster: SuggestEntry[], today: DayKey, wide = false): SubscriptionSuggestion | null {
    const newestFirst = [...cluster].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id))
    const sinceLast = daysBetween(newestFirst[0].date, today)
    const countOf = (min: number) => (wide ? Math.max(min, VARIABLE_MIN_COUNT) : min)

    const monthly = latestRun(newestFirst, MONTHLY_GAP)
    if (monthly.length >= countOf(MONTHLY_MIN_COUNT) && sinceLast <= MONTHLY_GAP.max + SUGGEST_GRACE_DAYS) {
        return buildSuggestion(key, index, monthly, "MONTHLY", 1)
    }
    const bimonthly = latestRun(newestFirst, BIMONTHLY_GAP)
    if (bimonthly.length >= countOf(BIMONTHLY_MIN_COUNT) && sinceLast <= BIMONTHLY_GAP.max + SUGGEST_GRACE_DAYS) {
        return buildSuggestion(key, index, bimonthly, "MONTHLY", 2)
    }
    const yearly = latestRun(newestFirst, YEARLY_GAP)
    if (yearly.length >= countOf(YEARLY_MIN_COUNT) && sinceLast <= YEARLY_GAP.max + SUGGEST_GRACE_DAYS) {
        return buildSuggestion(key, index, yearly, "YEARLY", 1)
    }
    return null
}

/** 並びの金額の幅が `VARIABLE_AMOUNT_SPREAD_RATIO` に収まるか */
function withinVariableSpread(suggestion: SubscriptionSuggestion): boolean {
    return suggestion.minAmount > 0 && suggestion.maxAmount <= suggestion.minAmount * VARIABLE_AMOUNT_SPREAD_RATIO
}

/**
 * 明細から定期払いの候補を出す。月あたりの金額の大きい順。
 * `entries` には、どの定期払いにも紐付いていない確定済みの支出だけを渡す。
 */
export function suggestSubscriptions(entries: SuggestEntry[], context: SuggestContext): SubscriptionSuggestion[] {
    const dismissed = new Set(context.dismissedKeys)
    const linked = new Set(context.linkedNames.map((name) => suggestionKey(name)).filter((key): key is string => key !== null))

    const groups = new Map<string, SuggestEntry[]>()
    for (const entry of entries) {
        if (entry.amount <= 0 || entry.date > context.today) continue
        const key = suggestionKey(entry.name)
        if (!key || dismissed.has(key) || linked.has(key)) continue
        const group = groups.get(key)
        if (group) group.push(entry)
        else groups.set(key, [entry])
    }

    const suggestions: SubscriptionSuggestion[] = []
    for (const [key, group] of groups) {
        if (group.length < YEARLY_MIN_COUNT) continue
        // 登録済みの定期払いと名前が合うお店は出さない（明細側の表記のどれかで照らす）
        const names = [...new Set(group.map((e) => e.name))]
        if (context.subscriptionNames.some((subscriptionName) => namesMatch(subscriptionName, names))) continue
        const found: SubscriptionSuggestion[] = []
        clusterByAmount(group).forEach((cluster, index) => {
            const suggestion = detect(key, index, cluster, context.today)
            if (suggestion) found.push(suggestion)
        })
        if (found.length === 0) {
            // 金額の束に分けて見つからなかったときだけ、電気代のように季節で大きく動く請求を1本の並びとして見る。
            // 同じ日に複数払う別契約（Appleなど）は間隔が0日で並びが途切れるので、ここでは混ざらない
            const wide = detect(key, 0, group, context.today, true)
            if (wide && withinVariableSpread(wide)) found.push(wide)
        }
        suggestions.push(...found)
    }
    return suggestions.sort((a, b) => b.monthlyAmount - a.monthlyAmount || (a.name < b.name ? -1 : 1))
}
