/**
 * 家計簿連携の明細を「確認 → 反映待ち → 反映済み」の3手順で見せるための判定（Issue #431）。
 *
 * DBの状態（`ReceiptStatus`）は増やさず、画面での並べ方だけをここで決める。
 * 画面（一覧・詳細）とテストが同じ対応を見るよう、状態→手順の対応はこのモジュールに寄せる。
 */

/** 3つの手順。`review` は確認、`waiting` はZaimでの反映待ち、`done` は反映済み。 */
export type ReceiptFlowStep = "review" | "waiting" | "done"

export const RECEIPT_FLOW_STEPS: ReceiptFlowStep[] = ["review", "waiting", "done"]

/**
 * 状態から手順を返す。**手順に載らない（止まっている）状態は `null`。**
 *
 * `MANUAL_ACTION_REQUIRED`（登録が途中で止まった）と `FAILED`（解析失敗）は、次へ進める操作が
 * 手順の中に無く人が中身を見るしかないため、手順の外に「止まっている明細」として出す。
 */
export function receiptFlowStep(status: string): ReceiptFlowStep | null {
    switch (status) {
        case "ANALYZING":
        case "REVIEW_REQUIRED":
        case "CONFIRMED":
            return "review"
        case "SENT_TO_ZAIM":
            return "waiting"
        case "REPLACED":
            return "done"
        default:
            return null
    }
}

/**
 * 反映待ちが長引いていると見なす日数。
 *
 * カードの連携明細がZaimに届くのは利用から数日後で、2週間を過ぎても置き換えていないのは
 * 置き換え忘れか、的になるカード明細を探せていないことが多い。
 */
export const WAITING_STALE_DAYS = 14

/**
 * `from` から `now` まで、JSTの暦日で何日たったかを返す。
 *
 * 時刻の差ではなく日付の差で数える。「昨日の23時に登録した」ものを翌朝に0日と出さないため。
 */
export function daysSinceJst(from: string | Date | null, now: Date): number | null {
    if (!from) return null
    const date = typeof from === "string" ? new Date(from) : from
    if (Number.isNaN(date.getTime())) return null
    const dayNumber = (value: Date) => {
        const [year, month, day] = new Intl.DateTimeFormat("sv-SE", {
            timeZone: "Asia/Tokyo",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        })
            .format(value)
            .split("-")
            .map(Number)
        return Date.UTC(year, month - 1, day) / 86_400_000
    }
    return Math.max(0, dayNumber(now) - dayNumber(date))
}

/** 「反映待ち」口座を登録先にしたときの理由。画面とサーバー側（`sendReceiptToZaim`）で揃える。 */
export const PENDING_ACCOUNT_BLOCKED_MESSAGE =
    "「反映待ち」口座へは登録できません（Zaimの置き換え候補にならないため、請求元のカードを選んでください）"

export interface RegisterReadinessInput {
    status: string
    /** 検算（明細合計と総額）が合っているか。 */
    amountMatched: boolean
    itemCount: number
    /** 内訳が決まっていない商品の数。 */
    undecidedItemCount: number
    purchasedAt: string | null
    storeName: string | null
    /** 登録先にするカード。行に記録済みのカード、無ければ画面で選んだ既定のカード。 */
    cardAccountId: number | null
    /** 登録先が「反映待ち」口座か（置き換え候補にならないため登録させない。#443）。 */
    cardIsPending?: boolean
    /** AIDE経由のWeb版登録が設定されているか。 */
    webRegisterConfigured: boolean
}

/**
 * 「正しい（登録）」で確定からカード登録まで進められるかを返す。進められないときはその理由。
 *
 * 条件は `confirmReceipt`（検算・内訳・購入日）と `sendReceiptToZaim`（店舗名・カード・AIDE設定）が
 * 弾くものに合わせてある。押してから失敗させるより、押す前に「修正」へ誘導するため。
 */
export function registerBlocker(input: RegisterReadinessInput): string | null {
    if (input.status === "ANALYZING") return "解析中です"
    if (input.status !== "REVIEW_REQUIRED" && input.status !== "CONFIRMED") {
        return "確認の手順にある明細ではありません"
    }
    if (input.itemCount === 0) return "商品がありません"
    if (!input.amountMatched) return "商品の合計が総額と一致していません"
    if (input.undecidedItemCount > 0) {
        return "内訳が決まっていない商品が" + input.undecidedItemCount + "品あります"
    }
    if (!input.purchasedAt) return "購入日が入っていません"
    if (!input.storeName?.trim()) return "店舗名が入っていません"
    if (!input.cardAccountId) return "登録先のカードが選ばれていません"
    if (input.cardIsPending) return PENDING_ACCOUNT_BLOCKED_MESSAGE
    if (!input.webRegisterConfigured) {
        return "AIDE経由のWeb版登録が設定されていません（AIDE_ZAIM_WRITE_SECRET）"
    }
    return null
}
