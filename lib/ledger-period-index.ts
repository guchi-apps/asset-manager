/**
 * 家計簿の期間を「月の通番」で扱う（Issue #1219）。取引明細の年月ピッカーが、選んだ年月を
 * 「今日を含む期間からいくつずれているか（offset）」へ直すために使う。
 *
 * 期間は1つずつ連続して並び、月の呼び名は `ledger-period.ts` の見出しと同じ規則
 * （開始日が1日なら開始日の月、それ以外は終了日の月）。したがって通番は期間ごとにちょうど1ずつ進む。
 */

/** 取引明細で動かせる offset の範囲（`loadLedgerPage` のクランプと同じ） */
export const LEDGER_OFFSET_LIMIT = 240

/** 期間の呼び名の月を、年*12+(月-1) の通番にする */
export function periodMonthIndex(period: { start: string; end: string }): number {
    const anchor = period.start.slice(8) === "01" ? period.start : period.end
    return Number(anchor.slice(0, 4)) * 12 + Number(anchor.slice(5, 7)) - 1
}

/** 通番を年・月（1〜12）へ戻す */
export function monthIndexParts(index: number): { year: number; month: number } {
    return { year: Math.floor(index / 12), month: (index % 12) + 1 }
}

/** 年・月から offset を求める。範囲外は端に丸める */
export function offsetForMonth(year: number, month: number, currentIndex: number): number {
    const delta = year * 12 + (month - 1) - currentIndex
    return Math.max(-LEDGER_OFFSET_LIMIT, Math.min(LEDGER_OFFSET_LIMIT, delta))
}
