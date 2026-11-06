/**
 * スマホ用の金額キーパッド（components/ui/amount-keypad.tsx）の入力ルール。
 * 値は「生の文字列」（例: "-1234.5"）で持ち、表示用のカンマ区切りは formatAmountRaw で作る。
 */

export interface KeypadOptions {
    /** 「±」を出して負の金額を入力できるようにする */
    allowNegative?: boolean
    /** 「.」を出して小数を入力できるようにする */
    allowDecimal?: boolean
}

/** 数字の最大桁数（符号・小数点を除く）。number で扱える範囲に収める */
export const KEYPAD_MAX_DIGITS = 15

/** 生の文字列を3桁区切りの表示用文字列にする（"-1234.5" → "-1,234.5"） */
export function formatAmountRaw(raw: string): string {
    if (raw === "" || raw === "-") return raw

    const negative = raw.startsWith("-")
    const unsigned = negative ? raw.slice(1) : raw
    const [integerPart, decimalPart] = unsigned.split(".")
    const integer = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",")

    return (negative ? "-" : "") + integer + (decimalPart !== undefined ? `.${decimalPart}` : "")
}

/** キー1つぶんの入力を生の文字列へ反映する。受け付けない入力は raw をそのまま返す */
export function applyKeypadKey(raw: string, key: string, options: KeypadOptions = {}): string {
    const negative = raw.startsWith("-")
    const body = negative ? raw.slice(1) : raw
    const sign = negative ? "-" : ""

    if (key === "bs") {
        const next = raw.slice(0, -1)
        return next === "-" ? "" : next
    }

    if (key === "sign") {
        if (!options.allowNegative) return raw
        return negative ? body : `-${body}`
    }

    if (key === ".") {
        if (!options.allowDecimal || body.includes(".")) return raw
        return `${sign}${body === "" ? "0" : body}.`
    }

    if (key !== "00" && !/^\d$/.test(key)) return raw

    const digitCount = body.replace(".", "").length
    if (digitCount + key.length > KEYPAD_MAX_DIGITS) return raw

    const dot = body.indexOf(".")
    if (dot !== -1) return `${sign}${body}${key}`

    // 先頭の0は1つにまとめる（"0" + "5" → "5"、"" + "00" → "0"）
    return `${sign}${(body + key).replace(/^0+(?=\d)/, "")}`
}

/**
 * Radix の Dialog / Sheet の `onPointerDownOutside` などへ渡す。
 * キーパッドは body 直下へ描画されるため、そのままだと「ダイアログの外側の操作」として閉じられてしまう。
 */
export function ignoreAmountKeypad(event: { target: EventTarget | null; preventDefault: () => void }) {
    if (event.target instanceof Element && event.target.closest("[data-amount-keypad]")) {
        event.preventDefault()
    }
}
