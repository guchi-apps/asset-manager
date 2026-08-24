/**
 * 「反映待ち」に登録したレシートと、後から反映されるカード明細の照合（Issue #153 Phase 7）。
 *
 * ここで行うのは候補の提示だけで、削除も統合もしない。Zaim標準の「置き換え」を人が押す前提で、
 * 「どの明細と置き換えればよいか」を分かる形にすることだけを担う。
 */

import { normalizeStoreName } from "@/lib/receipt-normalize"

/** これ未満の候補は提示しない。ノイズを並べても確認の手間が増えるだけ。 */
export const MIN_CANDIDATE_SCORE = 0.5
/** 1件のレシートに対して並べる候補の上限。 */
export const MAX_CANDIDATES_PER_RECEIPT = 5
/** これ以上日付が離れた明細は、金額が一致していても別の買い物として扱う。 */
export const MAX_DATE_DISTANCE_DAYS = 62

export interface PendingReceipt {
    id: number
    storeName: string | null
    /** 購入日。カード明細の計上日とはずれる。 */
    purchasedAt: Date | null
    totalAmount: number | null
    /** 「反映待ち」へ登録した支出のZaim id。自分自身を候補にしないために使う。 */
    zaimMoneyId: number | null
    /** 「反映待ち」口座のid。同じ口座の明細は候補から外す。 */
    zaimAccountId: number | null
    /**
     * 連携由来（スマートレシート・Amazon）の取り込み元口座id。
     * 元明細は金額・日付・店舗がすべて一致するため、除外しないと必ず最上位の候補になってしまう。
     */
    sourceAccountId?: number | null
}

export interface ZaimMoneyEntry {
    id: number
    /** YYYY-MM-DD */
    date: string
    amount: number
    place: string | null
    fromAccountId: number | null
    accountName: string | null
}

export interface MatchCandidate {
    receiptId: number
    zaimMoneyId: number
    amount: number
    date: Date
    accountName: string | null
    placeName: string | null
    score: number
    reason: string
}

function toDayKey(date: Date): string {
    return date.toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" })
}

function dayDistance(a: string, b: string): number {
    const left = Date.parse(a + "T00:00:00+09:00")
    const right = Date.parse(b + "T00:00:00+09:00")
    if (Number.isNaN(left) || Number.isNaN(right)) return Number.POSITIVE_INFINITY
    return Math.round(Math.abs(left - right) / 86_400_000)
}

/** 一方が他方を含んでいれば同じ店とみなす（「イオン」と「イオン西新井」など）。 */
function storeMatches(receiptStore: string | null, place: string | null): boolean {
    const left = normalizeStoreName(receiptStore)
    const right = normalizeStoreName(place)
    if (!left || !right) return false
    return left === right || left.includes(right) || right.includes(left)
}

/**
 * 1件のレシートと1件の明細の一致度を返す。候補にならない場合は null。
 *
 * 金額はカード明細でも一致するのが普通なので主軸に置き、日付と店舗名は補助にする。
 * 日付をゆるく見るのは、カード明細の計上日が購入日から数日〜1か月ずれるため。
 */
export function scoreMatch(
    receipt: PendingReceipt,
    entry: ZaimMoneyEntry
): { score: number; reason: string } | null {
    if (!receipt.totalAmount || receipt.totalAmount <= 0) return null
    if (receipt.zaimMoneyId && receipt.zaimMoneyId === entry.id) return null
    // 「反映待ち」口座の明細は、自分が登録したものか同じ運用の一時登録なので候補にしない。
    if (receipt.zaimAccountId && entry.fromAccountId === receipt.zaimAccountId) return null
    // 連携口座（スマートレシート・Amazon）にはカード明細が入らない。取り込み元そのものなので候補にしない。
    if (receipt.sourceAccountId && entry.fromAccountId === receipt.sourceAccountId) return null

    const reasons: string[] = []
    const amountDifference = Math.abs(entry.amount - receipt.totalAmount)
    let score: number

    if (amountDifference === 0) {
        score = 0.6
        reasons.push("金額一致")
    } else if (amountDifference <= Math.max(10, receipt.totalAmount * 0.01)) {
        score = 0.35
        reasons.push("金額が" + amountDifference.toLocaleString() + "円違い")
    } else {
        return null
    }

    if (!receipt.purchasedAt) return null
    const distance = dayDistance(toDayKey(receipt.purchasedAt), entry.date)
    if (distance > MAX_DATE_DISTANCE_DAYS) return null

    if (distance <= 3) {
        score += 0.25
        reasons.push(distance === 0 ? "同日" : "日付" + distance + "日差")
    } else if (distance <= 7) {
        score += 0.15
        reasons.push("日付" + distance + "日差")
    } else {
        score += 0.05
        reasons.push("日付" + distance + "日差")
    }

    if (storeMatches(receipt.storeName, entry.place)) {
        score += 0.15
        reasons.push("店舗名一致")
    }

    return { score: Math.min(1, Number(score.toFixed(3))), reason: reasons.join(" / ") }
}

/**
 * 「反映待ち」に登録済みのレシートごとに、置き換え候補を並べる。
 *
 * 1件の明細が複数のレシートの候補になることは許す。どちらが正しいかは人が決めるため、
 * ここで機械的に片方へ寄せると、正しい候補を隠してしまう。
 */
export function findMatchCandidates(
    receipts: PendingReceipt[],
    entries: ZaimMoneyEntry[]
): MatchCandidate[] {
    const candidates: MatchCandidate[] = []

    for (const receipt of receipts) {
        const scored: MatchCandidate[] = []

        for (const entry of entries) {
            const result = scoreMatch(receipt, entry)
            if (!result || result.score < MIN_CANDIDATE_SCORE) continue

            scored.push({
                receiptId: receipt.id,
                zaimMoneyId: entry.id,
                amount: entry.amount,
                date: new Date(entry.date + "T00:00:00+09:00"),
                accountName: entry.accountName,
                placeName: entry.place,
                score: result.score,
                reason: result.reason,
            })
        }

        scored.sort((a, b) => b.score - a.score || a.zaimMoneyId - b.zaimMoneyId)
        candidates.push(...scored.slice(0, MAX_CANDIDATES_PER_RECEIPT))
    }

    return candidates
}
