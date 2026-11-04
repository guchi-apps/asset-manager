/**
 * 家計簿連携の明細を「確認 → 反映待ち → 反映」の手順で見せるための判定（Issue #431・#466）。
 *
 * Gmail等の明細は早く届き、カードの連携明細は利用から数日遅れてZaimに届く。#466 までは
 * 「確認」で登録を押した時点でZaimへ送っていたため、この待ち時間が手順に表れていなかった。
 * いまは **確認で中身を確定 → 連携明細の到着を待つ → 届いたらZaimへ登録して置き換える** の順に並べる。
 * **Zaimへの登録・置き換え（旧運用）は #823 で廃止した。** 確定したレシートは家計簿へ登録する
 * （`lib/ledger-receipt-service.ts`）。`reflect`・`done` は旧運用で進めた明細を表示するためだけに残す。
 *
 * #431 では「反映済み」を手順の最後に並べていたが、#456 で画面から外した。家計簿連携は
 * 記録を残すための機能ではなく、Zaimへ記録するときにGmail等の明細を使うための機能のため。
 *
 * DBの状態（`ReceiptStatus`）は増やさず、画面での並べ方だけをここで決める。
 * 画面（一覧・詳細・突合せ）とテストが同じ対応を見るよう、状態→手順の対応はこのモジュールに寄せる。
 */

/**
 * 画面に並べる手順。
 *
 * - `review`（確認）: 中身を直して確定する。まだZaimへは送らない
 * - `waiting`（反映待ち）: 確定済み（`CONFIRMED`）。カードの連携明細がZaimに届くのを待つ
 * - `reflect`（反映）: Zaimへ登録済み（`SENT_TO_ZAIM`）。Zaimアプリで置き換える
 *
 * **#466 より前は `waiting` が `SENT_TO_ZAIM` を指していた。** 古いIssue・コメントの「反映待ち」は
 * いまの `reflect` にあたる。
 */
export type ReceiptFlowStep = "review" | "waiting" | "reflect"

export const RECEIPT_FLOW_STEPS: ReceiptFlowStep[] = ["review", "waiting", "reflect"]

/**
 * 状態から手順を返す。置き換え済みは `done`（手順の後ろで、画面には並べない）。
 * **手順に載らない（止まっている）状態は `null`。**
 *
 * `MANUAL_ACTION_REQUIRED`（登録が途中で止まった）と `FAILED`（解析失敗）は、次へ進める操作が
 * 手順の中に無く人が中身を見るしかないため、手順の外に「止まっている明細」として出す。
 *
 * AIが高信頼と判定した明細は取り込み時点で `CONFIRMED` になるため、確認を通らず最初から
 * 反映待ちに並ぶ（反映待ちからも修正は開ける）。
 */
export function receiptFlowStep(status: string): ReceiptFlowStep | "done" | null {
    switch (status) {
        case "ANALYZING":
        case "REVIEW_REQUIRED":
            return "review"
        case "CONFIRMED":
            return "waiting"
        case "SENT_TO_ZAIM":
            return "reflect"
        case "REPLACED":
            return "done"
        default:
            return null
    }
}

/** まだZaimへ登録していない手順（確認・反映待ち）か。削除できる・Zaimの明細との重複を見る、の判定に使う。 */
export function isBeforeZaimRegister(status: string): boolean {
    const step = receiptFlowStep(status)
    return step === "review" || step === "waiting"
}

/**
 * 反映待ち・反映が長引いていると見なす日数。
 *
 * カードの連携明細がZaimに届くのは利用から数日後で、2週間を過ぎても進んでいないのは
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

/** 商品別の明細が取れていない行が残っているとき。再取得するか、利用者が補完するまで先へ進めない（#663）。 */
export const DETAIL_MISSING_MESSAGE =
    "商品別の明細を取得できていない行があります（元の取引から再取得するか、内容を入力して補完してください）"

export interface ConfirmReadinessInput {
    status: string
    /** 検算（明細合計と総額）が合っているか。 */
    amountMatched: boolean
    itemCount: number
    /** 内訳が決まっていない商品の数。 */
    undecidedItemCount: number
    /**
     * 商品別の内訳を取得できていない商品の数（Issue #663）。代表商品名＋合計の行は
     * 商品明細ではないので、確定に進めない。
     */
    detailMissingItemCount?: number
    purchasedAt: string | null
}

/**
 * 確認の「確定」で反映待ちへ進められるかを返す。進められないときはその理由（Issue #466）。
 *
 * 条件は `confirmReceipt`（検算・内訳・購入日）が弾くものに合わせてある。
 */
export function confirmBlocker(input: ConfirmReadinessInput): string | null {
    if (input.status === "ANALYZING") return "解析中です"
    if (input.status !== "REVIEW_REQUIRED") return "確認の手順にある明細ではありません"
    if (input.itemCount === 0) return "商品がありません"
    if ((input.detailMissingItemCount ?? 0) > 0) return DETAIL_MISSING_MESSAGE
    if (!input.amountMatched) return "商品の合計が総額と一致していません"
    if (input.undecidedItemCount > 0) {
        return "内訳が決まっていない商品が" + input.undecidedItemCount + "品あります"
    }
    if (!input.purchasedAt) return "購入日が入っていません"
    return null
}
