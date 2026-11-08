export const JST_TIMEZONE = "Asia/Tokyo"

/** 早朝の一括入力では前日をデフォルトにする（JST 9時未満） */
export const EARLY_MORNING_CUTOFF_HOUR_JST = 9

// **呼ぶたびに `toLocaleDateString("en-CA", { timeZone })` を使わない（#1154）。** options を渡すと V8 は
// ICU のフォーマッタを毎回作り直し、その確保はネイティブヒープ（malloc）に積もる。評価額の全行で呼ぶ
// ダッシュボードの集計では1回の表示で約0.9GB膨らみ、本番のPM2再起動の原因になっていた。
// 詳細は docs/production-memory.md。
const JST_DAY_KEY_FORMAT = new Intl.DateTimeFormat("en-CA", { timeZone: JST_TIMEZONE })

export function getCalendarDayKey(date: Date): string {
    return JST_DAY_KEY_FORMAT.format(date)
}

export function getJstDayBounds(dayKey: string): { start: Date; end: Date } {
    return {
        start: new Date(`${dayKey}T00:00:00+09:00`),
        end: new Date(`${dayKey}T23:59:59.999+09:00`),
    }
}

/** @deprecated Use getJstDayBounds */
export function getUtcDayBounds(dayKey: string): { start: Date; end: Date } {
    return getJstDayBounds(dayKey)
}

export function addCalendarDays(isoDate: string, deltaDays: number): string {
    const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number)
    const utc = Date.UTC(y, m - 1, d) + deltaDays * 86400000
    return new Date(utc).toISOString().slice(0, 10)
}

function getJstHour(date: Date): number {
    return Number(
        date.toLocaleString("en-US", {
            timeZone: JST_TIMEZONE,
            hour: "numeric",
            hour12: false,
        })
    )
}

export function getTodayDateInput(now = new Date()): string {
    return getCalendarDayKey(now)
}

/** 一括評価額入力のデフォルト日付（早朝は前日を返す） */
export function getDefaultValuationDateInput(now = new Date()): string {
    const today = getTodayDateInput(now)
    if (getJstHour(now) < EARLY_MORNING_CUTOFF_HOUR_JST) {
        return addCalendarDays(today, -1)
    }
    return today
}

/**
 * 取引ダイアログ等、日付ピッカー（Date オブジェクト）の初期値。
 * 一括評価額入力と同じ「早朝(JST 9時未満)は前日扱い」に揃えることで、同じ朝に
 * 入金と評価額変更を行っても日付がズレて別レコードに分かれないようにする。
 * 実時刻をそのまま前日にずらすだけで、「まだ来ていない時刻」に見えて
 * 日付ピッカーで選択不可にならないようにする。
 */
export function getDefaultTransactionDate(now = new Date()): Date {
    if (getDefaultValuationDateInput(now) === getTodayDateInput(now)) {
        return now
    }
    return new Date(now.getTime() - 24 * 60 * 60 * 1000)
}

export function normalizeRecordDate(date: Date): Date {
    const dayKey = getCalendarDayKey(date)
    return new Date(`${dayKey}T12:00:00+09:00`)
}

export function parseValuationDateInput(dateInput: string | Date): Date {
    if (dateInput instanceof Date) {
        return normalizeRecordDate(dateInput)
    }

    const dayKey = dateInput.slice(0, 10)
    return new Date(`${dayKey}T12:00:00+09:00`)
}

export function formatCalendarDayKey(dayKey: string): string {
    const date = parseValuationDateInput(dayKey)
    return date.toLocaleDateString("ja-JP", {
        timeZone: JST_TIMEZONE,
        year: "numeric",
        month: "long",
        day: "numeric",
    })
}
