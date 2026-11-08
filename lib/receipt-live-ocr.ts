/**
 * カメラ画面の端末内OCR（Issue #1095）が返した文字列から、合計金額と日付を取り出す。
 * 精度の低いOCRの出力が前提なので、誤読を拾うより「読めない」を選ぶ（確定値は撮影後のAI読み取り）。
 */

export interface LiveReceiptFields {
    /** 合計金額（円）。読めなければ null */
    total: number | null
    /** 日付（YYYY-MM-DD）。読めなければ null */
    date: string | null
}

const TOTAL_KEYWORDS = /(合計|お買上計|お買上げ計|お買い上げ計|お会計|ご請求|税込計|total)/i
const SUBTOTAL_KEYWORDS = /(小計|対象|内税|外税|消費税|税額|預り|お釣|釣銭|現金|クレジット)/
const MAX_TOTAL = 9_999_999

/** 全角の数字・記号を半角へ、OCRが文字間に挟む空白を除く */
function normalizeText(text: string): string {
    return text.normalize("NFKC").replace(/[¥￥]/g, "¥")
}

function compactLine(line: string): string {
    return line.replace(/\s+/g, "")
}

function pad2(value: number): string {
    return String(value).padStart(2, "0")
}

function isValidDate(year: number, month: number, day: number, now: Date): boolean {
    if (month < 1 || month > 12 || day < 1 || day > 31) return false
    // 未来すぎる日付と古すぎる日付は誤読として捨てる
    if (year < now.getFullYear() - 5 || year > now.getFullYear() + 1) return false
    const probe = new Date(Date.UTC(year, month - 1, day))
    return probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day
}

/** 日付を探す。西暦（2026/11/05・2026年11月5日）と令和（令和8年11月5日）に対応 */
export function extractDate(text: string, now: Date = new Date()): string | null {
    const compact = compactLine(normalizeText(text))
    const patterns: Array<{ regex: RegExp; toYear: (n: number) => number }> = [
        { regex: /(20\d{2})[/.\-年](\d{1,2})[/.\-月](\d{1,2})/g, toYear: (n) => n },
        { regex: /令和(\d{1,2})年(\d{1,2})月(\d{1,2})/g, toYear: (n) => 2018 + n },
    ]
    for (const { regex, toYear } of patterns) {
        for (const match of compact.matchAll(regex)) {
            const year = toYear(Number(match[1]))
            const month = Number(match[2])
            const day = Number(match[3])
            if (isValidDate(year, month, day, now)) return `${year}-${pad2(month)}-${pad2(day)}`
        }
    }
    return null
}

/** 行の中の金額（¥・円・カンマ区切り・単独の数字）を左から順に返す */
function amountsInLine(line: string): number[] {
    const amounts: number[] = []
    for (const match of line.matchAll(/¥?(\d{1,3}(?:,\d{3})+|\d+)円?/g)) {
        const value = Number(match[1].replace(/,/g, ""))
        if (Number.isFinite(value) && value > 0 && value <= MAX_TOTAL) amounts.push(value)
    }
    return amounts
}

/**
 * 合計金額を探す。「合計」「お会計」などのキーワード行の金額（点数が前に付いても最後の数字）を採る。
 * 小計・対象額・預り金・釣銭の行は除く。キーワード行が複数あるときは最も下の行（レシートの合計は下にある）
 */
export function extractTotal(text: string): number | null {
    const lines = normalizeText(text).split(/\r?\n/).map(compactLine)
    let found: number | null = null
    for (const line of lines) {
        if (!TOTAL_KEYWORDS.test(line) || SUBTOTAL_KEYWORDS.test(line)) continue
        // 「合計3点¥1,280」の点数を金額と取り違えないよう、点数の表記は先に除く
        const amounts = amountsInLine(line.replace(/\d+[点個品]/g, ""))
        const last = amounts[amounts.length - 1]
        if (last !== undefined) found = last
    }
    return found
}

export function extractReceiptFields(text: string, now: Date = new Date()): LiveReceiptFields {
    return { total: extractTotal(text), date: extractDate(text, now) }
}

/** 表示用: 2026-11-05 → 2026/11/05 */
export function formatLiveDate(date: string): string {
    return date.replace(/-/g, "/")
}

/** 表示用: 1280 → ¥1,280 */
export function formatLiveTotal(total: number): string {
    return `¥${total.toLocaleString("ja-JP")}`
}

/**
 * 画面のちらつきを抑えるため、同じ値が続けて読めたときだけ表示を更新する。
 * 1回の誤読で値が出入りしないよう、直近の読み取りと一致した値だけを返す。
 */
export function confirmStable(previous: LiveReceiptFields | null, current: LiveReceiptFields): LiveReceiptFields {
    return {
        total: previous && previous.total === current.total ? current.total : null,
        date: previous && previous.date === current.date ? current.date : null,
    }
}
