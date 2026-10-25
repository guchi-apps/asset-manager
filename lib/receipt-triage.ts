/**
 * 家計簿連携の作業一覧を「要対応・要判断・今は作業不要」に振り分ける（Issue #768）。
 *
 * **振り分けは保存しない。** 画面を開くたびに、その時点のカード明細・取り込み明細・検索の記録から
 * 計算し直す。候補が後から届けば自動で要対応へ戻るようにするためで、保存するのは人が決めたこと
 * （カード明細の「対応しない」#632、取り込み明細の「使わない」・同じ支払いで選んだ明細）だけにとどめる。
 *
 * - **候補が無いことと、探せていないことを混同しない。** 検索の失敗・未実行・スマートレシートを
 *   読めなかった・取り込み範囲外は要判断にし、作業不要にしない
 * - **自動で確定しない。** 候補が1件で金額も一致していても、要対応（人が中身を見て選ぶ）にとどめる。
 *   同額の別支払い・同じ情報源の複数候補・金額のずれは要判断
 * - **同じ支払いの複数ソース**（スマートレシートとGmailなど）は、別々の支出ではなく1つの組として返す
 */
import { isNearAmount } from "./receipt-reconcile"

export type TriageBucket = "action" | "decide" | "rest"

/** カード計上日と購入日の許容日数。候補探しと同じ値を使う。 */
export const TRIAGE_MATCH_WINDOW_DAYS = 14
/** 候補・カード明細がまだ届いていないとみなして待つ日数。 */
export const TRIAGE_WAIT_DAYS = 14

const DAY_MS = 86_400_000

function dayNumber(day: string): number | null {
    const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
    if (!matched) return null
    return Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3])) / DAY_MS
}

function daysBetween(from: string, to: string): number | null {
    const left = dayNumber(from)
    const right = dayNumber(to)
    return left === null || right === null ? null : right - left
}

export interface TriageCardInput {
    moneyId: number
    /** カード計上日（JSTの `YYYY-MM-DD`）。 */
    date: string
    amount: number
}

export interface TriageReceiptInput {
    id: number
    source: string
    /** 購入日（JSTの `YYYY-MM-DD`）。 */
    purchasedAt: string | null
    totalAmount: number | null
    /** 金額が概算か（外貨を円へ換算したなど。Issue #772）。円建ての確定額なら false。 */
    amountApproximate: boolean
}

/**
 * カード明細の候補にしてよい詳細明細か。購入日と計上日はずれ得るので、日付は絞り込みの補助にとどめる。
 * 金額は円建てなら厳密に一致したものだけ。近い金額を許すのは、為替換算で数円〜数十円ずれる概算の明細だけ（Issue #772）。
 */
export function isCardCandidate(card: TriageCardInput, receipt: TriageReceiptInput): boolean {
    if (!receipt.purchasedAt || receipt.totalAmount === null) return false
    const distance = daysBetween(card.date, receipt.purchasedAt)
    if (distance === null || Math.abs(distance) > TRIAGE_MATCH_WINDOW_DAYS) return false
    if (card.amount === receipt.totalAmount) return true
    return receipt.amountApproximate && isNearAmount(card.amount, receipt.totalAmount)
}

export interface DetailSearchRecord {
    /** 最後に「詳細明細を探す」を実行した時刻（ISO8601）。一度も無ければ null。 */
    searchedAt: string | null
    /** 失敗した理由。成功なら null。 */
    error: string | null
    /** 成功したがスマートレシート（AIDE経由）を読めなかった理由。 */
    webReason: string | null
}

export interface TriageContext {
    /** 今日（JSTの `YYYY-MM-DD`）。 */
    today: string
    /** `searchedAt` をJSTの日付にしたもの。呼び出し側で変換して渡す。 */
    searchedDay: string | null
    search: DetailSearchRecord
    /** 「詳細明細を探す」が遡って取り込む日数。これより古いカード明細は自動では探せない。 */
    lookbackDays: number
}

export type CardTriageReason =
    | "single"
    | "samePayment"
    | "multiple"
    | "contested"
    | "amountMismatch"
    | "notSearched"
    | "searchFailed"
    | "webUnavailable"
    | "outOfRange"
    | "waiting"
    | "noCandidate"

export interface CardTriage {
    bucket: TriageBucket
    reason: CardTriageReason
    /** 金額が一致し情報源が違う、同じ支払いとみなした候補のid（`samePayment` のときだけ2件以上）。 */
    samePaymentIds: number[]
    /** 別の未対応カード明細も候補にしている候補のid。 */
    contestedIds: number[]
}

/**
 * カード明細ごとに区分と理由を決める。`cards` は未対応（対応済み・対応しない以外）のカード明細全部を渡す。
 * 別のカード明細との取り合いを見るため、1件ずつではなくまとめて判定する。
 */
export function triageCards(
    cards: ReadonlyArray<TriageCardInput & { candidates: readonly TriageReceiptInput[] }>,
    context: TriageContext
): Map<number, CardTriage> {
    // 取り合いは金額が一致する主張だけで数える。金額が近いだけの別のカード明細（為替・端数のずれの可能性）が
    // 候補に挙げていても、金額が一致するカード明細の判断を止めない（実AIDE一覧で ¥2,061 と ¥2,100 が重なった）。
    const claims = new Map<number, number>()
    for (const card of cards) {
        for (const candidate of card.candidates) {
            if (candidate.totalAmount === card.amount) claims.set(candidate.id, (claims.get(candidate.id) ?? 0) + 1)
        }
    }

    const result = new Map<number, CardTriage>()
    for (const card of cards) {
        const contestedIds = card.candidates
            .filter((c) => (claims.get(c.id) ?? 0) - (c.totalAmount === card.amount ? 1 : 0) > 0)
            .map((c) => c.id)
        const exact = card.candidates.filter((c) => c.totalAmount === card.amount)
        const triage = (bucket: TriageBucket, reason: CardTriageReason, samePaymentIds: number[] = []): CardTriage =>
            ({ bucket, reason, samePaymentIds, contestedIds })

        if (card.candidates.length > 0) {
            if (exact.length === 0) result.set(card.moneyId, triage("decide", "amountMismatch"))
            else if (contestedIds.length > 0) result.set(card.moneyId, triage("decide", "contested"))
            else if (card.candidates.length === 1) result.set(card.moneyId, triage("action", "single"))
            else {
                const sources = new Set(exact.map((c) => c.source))
                const samePayment = exact.length >= 2 && sources.size === exact.length && exact.length === card.candidates.length
                result.set(
                    card.moneyId,
                    samePayment ? triage("decide", "samePayment", exact.map((c) => c.id)) : triage("decide", "multiple")
                )
            }
            continue
        }

        const age = daysBetween(card.date, context.today)
        if (age !== null && age > context.lookbackDays) {
            result.set(card.moneyId, triage("decide", "outOfRange"))
        } else if (context.search.searchedAt === null || context.searchedDay === null || context.searchedDay < card.date) {
            result.set(card.moneyId, triage("decide", "notSearched"))
        } else if (context.search.error) {
            result.set(card.moneyId, triage("decide", "searchFailed"))
        } else if (context.search.webReason) {
            result.set(card.moneyId, triage("decide", "webUnavailable"))
        } else if (age !== null && age <= TRIAGE_WAIT_DAYS) {
            result.set(card.moneyId, triage("rest", "waiting"))
        } else {
            result.set(card.moneyId, triage("rest", "noCandidate"))
        }
    }
    return result
}

export type ReceiptTriageReason =
    | "incomplete"
    | "cardListUnavailable"
    | "beforeStart"
    | "awaitingCard"
    | "matchedElsewhere"
    | "dismissedCard"
    | "noCard"

export interface ReceiptTriage {
    bucket: TriageBucket
    reason: ReceiptTriageReason
}

/**
 * どの未対応カード明細の候補にもならなかった取り込み明細の区分を決める。
 * 未対応カード明細の候補になったものはカード明細の側に出すので、ここへは渡さない。
 */
export function triageLooseReceipt(
    receipt: TriageReceiptInput,
    context: {
        today: string
        /** カード明細の一覧を読めたか。読めなければ「カード明細が無い」とは言えない。 */
        cardListAvailable: boolean
        /** これ以前のカード明細は一覧に出していない（`receiptCardFlowStartedAt`）。 */
        startsAfter: string
        matchedCards: readonly TriageCardInput[]
        dismissedCards: readonly TriageCardInput[]
    }
): ReceiptTriage {
    if (!receipt.purchasedAt || receipt.totalAmount === null) return { bucket: "decide", reason: "incomplete" }
    if (!context.cardListAvailable) return { bucket: "decide", reason: "cardListUnavailable" }
    if (receipt.purchasedAt <= context.startsAfter) return { bucket: "rest", reason: "beforeStart" }
    const exactMatch = (card: TriageCardInput) => card.amount === receipt.totalAmount && isCardCandidate(card, receipt)
    if (context.matchedCards.some(exactMatch)) return { bucket: "rest", reason: "matchedElsewhere" }
    if (context.dismissedCards.some(exactMatch)) return { bucket: "rest", reason: "dismissedCard" }
    const age = daysBetween(receipt.purchasedAt, context.today)
    if (age !== null && age <= TRIAGE_WAIT_DAYS) return { bucket: "rest", reason: "awaitingCard" }
    return { bucket: "decide", reason: "noCard" }
}

/** 区分の理由を、画面に出す見出し・説明・次の操作にする。 */
export function describeCardTriage(
    reason: CardTriageReason,
    detail: { candidateCount: number; search: DetailSearchRecord; lookbackDays: number }
): { label: string; why: string; next: string | null } {
    switch (reason) {
        case "single":
            return { label: "候補1件", why: "候補が1件で、金額が一致しています。", next: "中身を確かめて「この明細で準備する」を押します。" }
        case "samePayment":
            return {
                label: "重複候補",
                why: `同じ支払いの詳細明細が${detail.candidateCount}つあります。別々の支出ではありません。`,
                next: "使う方を1つ選びます。選ばなかった方は作業不要へ移り、削除はしません。",
            }
        case "multiple":
            return { label: "候補が複数", why: `候補が${detail.candidateCount}件あり、どれがこの支払いか自動では決められません。`, next: "日付・店舗・商品を見比べて1つ選びます。" }
        case "contested":
            return { label: "同額の別支払い", why: "同じ候補を別のカード明細も候補にしています。同じ日・同じ金額の別の支払いかもしれません。", next: "日付・店舗を見比べて、この支払いの明細かを確かめてから選びます。" }
        case "amountMismatch":
            return { label: "金額が違う", why: "候補の金額がカード明細と一致しません。為替や端数のずれかもしれません。", next: "同じ支払いなら選んだあと、詳細画面でカードの金額に合わせます。" }
        case "notSearched":
            return { label: "取得不足", why: "このカード明細が届いたあと、まだ詳細明細を探していません。", next: "「詳細明細を探す」を押します。" }
        case "searchFailed":
            return { label: "取得不足", why: `前回の検索に失敗しました（${detail.search.error}）。候補が無いとはまだ言えません。`, next: "「詳細明細を探す」で取り直します。続けて失敗するときは連携の設定を確認します。" }
        case "webUnavailable":
            return { label: "取得不足", why: `前回の検索でスマートレシートを読めませんでした（${detail.search.webReason}）。候補が無いとはまだ言えません。`, next: "「詳細明細を探す」で取り直します。続けて読めないときは連携の設定を確認します。" }
        case "outOfRange":
            return { label: "取得範囲外", why: `取り込み範囲（直近${detail.lookbackDays}日）より古く、詳細明細を自動では探せません。`, next: "カード明細のまま記録するなら「対応しない」を押します。" }
        case "waiting":
            return { label: "到着待ち", why: "探しましたが候補はありません。後からスマートレシートやメールが届けば要対応へ戻ります。", next: null }
        case "noCandidate":
            return { label: "候補なし", why: "探しましたが候補はありません。Zaimではカード明細のまま記録されます。", next: "一覧から外すなら「対応しない」を押します。" }
    }
}

export function describeReceiptTriage(reason: ReceiptTriageReason): { label: string; why: string; next: string | null } {
    switch (reason) {
        case "incomplete":
            return { label: "読み取り不足", why: "日付か金額が読めていないため、カード明細と照合できません。", next: "詳細画面で日付・金額を直します。" }
        case "cardListUnavailable":
            return { label: "取得不足", why: "カード明細の一覧を読めないため、対応するカード明細があるか分かりません。", next: "「更新」で読み直します。" }
        case "beforeStart":
            return { label: "移行前", why: "カード明細起点の流れを始める前の明細です。", next: null }
        case "awaitingCard":
            return { label: "到着待ち", why: "対応するカード明細がまだ届いていません。届けばそのカード明細の候補に出ます。", next: null }
        case "matchedElsewhere":
            return { label: "同じ支払いは対応済み", why: "同じ金額のカード明細は、別の詳細明細で対応済みです。", next: "使わないなら「使わない」を押します。" }
        case "dismissedCard":
            return { label: "カード明細は対応しない", why: "同じ金額のカード明細を「対応しない」に記録しています。", next: "使わないなら「使わない」を押します。" }
        case "noCard":
            return { label: "カード明細なし", why: "対応するカード明細が見つかりません。現金や別の口座で払った可能性があります。", next: "不要なら「使わない」にします。削除は「取り込み明細」タブからできます。" }
    }
}
