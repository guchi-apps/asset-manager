/**
 * クレジットカードの登録（Issue #1586）。DBに触らない純粋な関数だけを置く。
 *
 * カード番号は**全桁を持たない**。上4桁（任意）と下4桁の数字だけを受け付け、セキュリティコードの欄は作らない。
 * 5桁以上の数字・ハイフンや空白を含む番号が送られてきても保存せず、エラーにする。
 */

/** 画面・口座の情報に渡す、カード1枚ぶん */
export interface CreditCardView {
    id: number
    name: string
    numberHead4: string | null
    numberTail4: string
    expiryMonth: number | null
    expiryYear: number | null
    /** 基本還元率（bp。50 = 0.5%）。未設定は null */
    rewardRateBp: number | null
    /** 紐付けた家計簿の口座。未設定は null */
    accountId: number | null
}

export interface ParsedCreditCard {
    name: string
    numberHead4: string | null
    numberTail4: string
    expiryMonth: number | null
    expiryYear: number | null
    rewardRateBp: number | null
    accountId: number | null
}

export type CreditCardParseResult = { ok: true; value: ParsedCreditCard } | { ok: false; error: string }

const NAME_MAX = 64
/** 還元率の上限（%）。入力ミス（50 を 5000 と打つなど）を弾く */
const RATE_MAX_PERCENT = 100

function str(v: unknown): string {
    return typeof v === "string" ? v.trim() : ""
}

/** 4桁の数字か（全角は半角に直す）。ちょうど4桁でなければ null */
function digits4(v: unknown): string | null {
    const s = str(v).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    return /^\d{4}$/.test(s) ? s : null
}

/** 空欄か */
function isBlank(v: unknown): boolean {
    return v === undefined || v === null || str(v) === ""
}

/** 入力を検証する。`accountId` は「自分の口座か」まではここでは見ない（アクション側で確かめる） */
export function parseCreditCardInput(raw: Record<string, unknown>): CreditCardParseResult {
    const name = str(raw.name)
    if (!name) return { ok: false, error: "カードの名前を入力してください" }
    if (name.length > NAME_MAX) return { ok: false, error: `カードの名前は${NAME_MAX}文字以内にしてください` }

    const tail = digits4(raw.numberTail4)
    if (!tail) return { ok: false, error: "カード番号の下4桁は、数字4桁で入力してください（全桁は保存できません）" }

    let head: string | null = null
    if (!isBlank(raw.numberHead4)) {
        head = digits4(raw.numberHead4)
        if (!head) return { ok: false, error: "カード番号の上4桁は、数字4桁で入力してください（空欄でも構いません）" }
    }

    let expiryMonth: number | null = null
    let expiryYear: number | null = null
    const hasMonth = !isBlank(raw.expiryMonth)
    const hasYear = !isBlank(raw.expiryYear)
    if (hasMonth !== hasYear) return { ok: false, error: "有効期限は、月と年をそろえて入力してください" }
    if (hasMonth && hasYear) {
        expiryMonth = Number(str(raw.expiryMonth))
        let year = Number(str(raw.expiryYear))
        if (!Number.isInteger(expiryMonth) || expiryMonth < 1 || expiryMonth > 12) return { ok: false, error: "有効期限の月は1〜12で入力してください" }
        // 2桁の年（29）は西暦（2029）として扱う
        if (Number.isInteger(year) && year >= 0 && year < 100) year += 2000
        if (!Number.isInteger(year) || year < 2000 || year > 2099) return { ok: false, error: "有効期限の年が正しくありません" }
        expiryYear = year
    }

    let rewardRateBp: number | null = null
    if (!isBlank(raw.rewardRatePercent)) {
        const percent = Number(str(raw.rewardRatePercent))
        if (!Number.isFinite(percent) || percent < 0 || percent > RATE_MAX_PERCENT) {
            return { ok: false, error: `基本還元率は0〜${RATE_MAX_PERCENT}（%）で入力してください` }
        }
        rewardRateBp = Math.round(percent * 100)
    }

    let accountId: number | null = null
    if (!isBlank(raw.accountId)) {
        accountId = Number(str(raw.accountId))
        if (!Number.isInteger(accountId) || accountId <= 0) return { ok: false, error: "紐付ける口座が正しくありません" }
    }

    return { ok: true, value: { name, numberHead4: head, numberTail4: tail, expiryMonth, expiryYear, rewardRateBp, accountId } }
}

/** 有効期限の状態。`expiring` は期限が3か月以内。期限は「その月の末日まで有効」 */
export type CreditCardExpiryState = "none" | "ok" | "expiring" | "expired"

export const EXPIRING_MONTHS = 3

/** `today` は JST の `YYYY-MM-DD`。残り月数（今月を0とし、期限の月までの差）も返す */
export function creditCardExpiry(
    card: Pick<CreditCardView, "expiryMonth" | "expiryYear">,
    today: string
): { state: CreditCardExpiryState; monthsLeft: number | null } {
    if (card.expiryMonth === null || card.expiryYear === null) return { state: "none", monthsLeft: null }
    const [y, m] = today.split("-").map(Number)
    const monthsLeft = (card.expiryYear - y) * 12 + (card.expiryMonth - m)
    if (monthsLeft < 0) return { state: "expired", monthsLeft }
    return { state: monthsLeft <= EXPIRING_MONTHS ? "expiring" : "ok", monthsLeft }
}

/** 券面風の番号表示。上4桁が無ければ伏せ字だけ（`‥‥ ‥‥ ‥‥ 1234`） */
export function formatCardNumber(card: Pick<CreditCardView, "numberHead4" | "numberTail4">): string {
    return `${card.numberHead4 ?? "‥‥"} ‥‥ ‥‥ ${card.numberTail4}`
}

/** 有効期限の表示（`08/29`）。未設定は null */
export function formatCardExpiry(card: Pick<CreditCardView, "expiryMonth" | "expiryYear">): string | null {
    if (card.expiryMonth === null || card.expiryYear === null) return null
    return `${String(card.expiryMonth).padStart(2, "0")}/${String(card.expiryYear % 100).padStart(2, "0")}`
}

/** 還元率の表示（`0.5%`）。未設定は null */
export function formatRewardRate(rewardRateBp: number | null): string | null {
    return rewardRateBp === null ? null : `${rewardRateBp / 100}%`
}

/** 口座選択画面に添える「カード下4桁 1234・9876」。紐付いたカードが無ければ null。同じ下4桁は1つにまとめる */
export function cardLast4Hint(cards: Pick<CreditCardView, "numberTail4">[]): string | null {
    const tails = [...new Set(cards.map((c) => c.numberTail4))]
    return tails.length === 0 ? null : `カード下4桁 ${tails.join("・")}`
}

/** カードに紐付けた口座の締め日・引き落とし日・引き落とし先（#1605。保存先は `LedgerAccount` の同名の列） */
export interface WithdrawalSetting {
    closingDay: number | null
    paymentDay: number | null
    /** 引き落とし日が締め日の何か月後か（0〜2） */
    paymentMonthOffset: number
    withdrawalAccountId: number | null
}

export type WithdrawalParseResult = { ok: true; value: WithdrawalSetting } | { ok: false; error: string }

/** 数値でも文字列でも受ける（フォームは文字列、呼び出し側が数値を渡すこともある） */
function num(v: unknown): string {
    return typeof v === "number" ? String(v) : str(v)
}

function blankNum(v: unknown): boolean {
    return v === undefined || v === null || num(v) === ""
}

function dayOrNull(v: unknown): number | null | undefined {
    if (blankNum(v) || num(v) === "none") return null
    const n = Number(num(v))
    return Number.isInteger(n) && n >= 1 && n <= 31 ? n : undefined
}

/** 引き落とし設定の入力を検証する。3つ（締め日・引き落とし日・引き落とし口座）はそろえるか、すべて空にする */
export function parseWithdrawalInput(raw: Record<string, unknown>): WithdrawalParseResult {
    const closingDay = dayOrNull(raw.closingDay)
    const paymentDay = dayOrNull(raw.paymentDay)
    if (closingDay === undefined) return { ok: false, error: "締め日は1〜31の日で選んでください" }
    if (paymentDay === undefined) return { ok: false, error: "引き落とし日は1〜31の日で選んでください" }
    const offset = blankNum(raw.paymentMonthOffset) ? 1 : Number(num(raw.paymentMonthOffset))
    if (!Number.isInteger(offset) || offset < 0 || offset > 2) return { ok: false, error: "引き落とし月は当月・翌月・翌々月から選んでください" }
    let withdrawalAccountId: number | null = null
    if (!blankNum(raw.withdrawalAccountId) && num(raw.withdrawalAccountId) !== "none") {
        withdrawalAccountId = Number(num(raw.withdrawalAccountId))
        if (!Number.isInteger(withdrawalAccountId) || withdrawalAccountId <= 0) return { ok: false, error: "引き落とし口座が正しくありません" }
    }
    const filled = [closingDay, paymentDay, withdrawalAccountId].filter((v) => v !== null).length
    if (filled !== 0 && filled !== 3) return { ok: false, error: "締め日・引き落とし日・引き落とし口座はそろえて設定してください" }
    return { ok: true, value: { closingDay, paymentDay, paymentMonthOffset: offset, withdrawalAccountId } }
}

/** 引き落とし設定を持てる口座か（カードの口座だけ。`lib/ledger-input.ts` の口座保存と同じ条件） */
export function canHoldWithdrawal(account: { kind: string; purpose: string | null }): boolean {
    return account.kind === "CARD" || account.purpose === "CREDIT_CARD"
}

/** カード一覧に出す「毎月15日締め・10日払い」。3つそろっていなければ null */
export function formatWithdrawalSummary(s: WithdrawalSetting | null): string | null {
    if (!s || s.closingDay === null || s.paymentDay === null) return null
    const day = (d: number) => (d === 31 ? "月末" : `${d}日`)
    return `毎月${day(s.closingDay)}締め・${day(s.paymentDay)}払い`
}
