/**
 * カードの引き落とし日・引き落とし口座を、家計簿の振替履歴から推定する（Issue #1157）。
 *
 * 連携した銀行の明細は、カードの引き落としを「銀行 → カード」の振替として返す（#1149）。その日付は
 * 「名目の引き落とし日を翌営業日へ送った日」なので、`shiftToBusinessDay(+1)` を逆にたどって名目の日を決める。
 * 締め日・引き落とし月は振替からは決まらないので扱わない（手入力のまま）。
 */
import { addDays, shiftToBusinessDay, toIsoDate, type IsoDate } from "@/lib/jp-holidays"

/** 提案に使う期間（日）。直近6か月ぶん */
export const SUGGEST_WINDOW_DAYS = 186
/** 提案に必要な、同じ口座から振替があった月の数 */
export const SUGGEST_MIN_MONTHS = 2

export interface CardTransfer {
    /** JSTの `YYYY-MM-DD` */
    date: string
    /** 出金元（銀行口座）の id */
    fromAccountId: number
}

export type WithdrawalSuggestion =
    | {
          ok: true
          withdrawalAccountId: number
          paymentDay: number
          /** 根拠にした振替の日付（昇順） */
          dates: string[]
          monthCount: number
      }
    | {
          ok: false
          /** none=振替が無い / few=月数が足りない / account=口座が割れた / day=日が1つに決まらない */
          reason: "none" | "few" | "account" | "day"
      }

/** その年月の名目の引き落とし日（月末より後の日は月末に丸める） */
function nominalDate(year: number, month: number, day: number): IsoDate {
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
    return toIsoDate(year, month, Math.min(day, last))
}

/** 名目の日が day のとき、yyyy-mm の月に起こりうる引き落としの日（その月の分と、前月の分が翌月へずれた分） */
function possibleDates(ym: string, day: number): IsoDate[] {
    const [y, m] = ym.split("-").map(Number)
    const prevY = m === 1 ? y - 1 : y
    const prevM = m === 1 ? 12 : m - 1
    return [shiftToBusinessDay(nominalDate(y, m, day), 1), shiftToBusinessDay(nominalDate(prevY, prevM, day), 1)]
}

/** 期間の始まり（この日を含む）。today から SUGGEST_WINDOW_DAYS 日前 */
export function suggestWindowStart(today: string): string {
    return addDays(today, -SUGGEST_WINDOW_DAYS)
}

/**
 * 振替（期間内・そのカード宛・銀行口座から・確定済み）から、引き落とし口座と名目の引き落とし日を決める。
 * 振替があった月の数が最も多い口座を引き落とし口座とし（同数なら決めない）、その口座の振替のすべての月で
 * 矛盾しない日のうち、一致する振替が最も多い日がちょうど1つのときだけ提案する。
 */
export function suggestCardWithdrawal(transfers: CardTransfer[]): WithdrawalSuggestion {
    if (transfers.length === 0) return { ok: false, reason: "none" }

    const byAccount = new Map<number, Map<string, Set<string>>>()
    for (const t of transfers) {
        const months = byAccount.get(t.fromAccountId) ?? new Map<string, Set<string>>()
        const ym = t.date.slice(0, 7)
        const dates = months.get(ym) ?? new Set<string>()
        dates.add(t.date)
        months.set(ym, dates)
        byAccount.set(t.fromAccountId, months)
    }

    const ranked = Array.from(byAccount.entries()).sort((a, b) => b[1].size - a[1].size)
    const [accountId, months] = ranked[0]
    if (months.size < SUGGEST_MIN_MONTHS) return { ok: false, reason: "few" }
    if (ranked.length > 1 && ranked[1][1].size === months.size) return { ok: false, reason: "account" }

    // すべての月で、その月のどれかの振替と一致する日を候補にする（繰上げ返済などが混ざっても落とさない）。
    // 候補が複数なら、一致する振替の多いほうを選ぶ（月末払いの前月分が翌月頭へずれると、1日払いでも各月に一致してしまうため）
    let best: number[] = []
    let bestHits = 0
    for (let day = 1; day <= 31; day++) {
        let hits = 0
        let everyMonth = true
        for (const [ym, dates] of months) {
            const possible = new Set(possibleDates(ym, day))
            const matched = Array.from(dates).filter((d) => possible.has(d)).length
            if (matched === 0) everyMonth = false
            hits += matched
        }
        if (!everyMonth) continue
        if (hits > bestHits) {
            best = [day]
            bestHits = hits
        } else if (hits === bestHits) {
            best.push(day)
        }
    }
    if (best.length !== 1) return { ok: false, reason: "day" }

    // 根拠として見せるのは、選んだ日と一致した振替だけ（繰上げ返済などは出さない）
    const dates = Array.from(months.entries())
        .flatMap(([ym, s]) => {
            const possible = new Set(possibleDates(ym, best[0]))
            return Array.from(s).filter((d) => possible.has(d))
        })
        .sort()
    return { ok: true, withdrawalAccountId: accountId, paymentDay: best[0], dates, monthCount: months.size }
}
