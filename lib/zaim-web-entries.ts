/**
 * Zaim Web版の明細（AIDE経由）を、連携明細の取り込みが読む形へ整える（Issue #383）。
 *
 * Web版の一覧が返すのは**表示のままの名前**（口座名・カテゴリ名・内訳名）で、Zaim APIが返した
 * `from_account_id` / `category_id` / `genre_id` は付いてこない。以前は取り込み済みのZaim APIのマスタ
 * （`ZaimAccount` / `ZaimGenre`）と名前で突き合わせてidへ寄せていたが、マスタはAPIの終了で更新されなく
 * なったため（#788・#843）、**名前のまま**渡す。由来（スマートレシート・Amazon）は口座名と家計簿の
 * 口座名の対応から決め（`lib/zaim-linked-source.ts`）、分類は家計簿のカテゴリへ寄せる（#843 その1）。
 *
 * **二重登録の防止はZaim明細idが取れることが前提**（`ReceiptItem.sourceZaimMoneyId` で照合する）。
 * idを取れなかった行は、取り込むと次回も候補に出て無限に増えるため**必ず落とす**。
 *
 * ここはDBもAIDEも触らない純粋な変換だけを持つ。
 */

import type { LinkedDetailItem } from "@/lib/linked-detail"
import type { ZaimAideMoneyEntry } from "@/lib/zaim-aide-money"

/** Web版の一覧から読んだ支出1件。口座・分類は名前のまま持つ。 */
export interface WebMoneyEntry {
    id: number
    /** YYYY-MM-DD（JST）。 */
    date: string
    amount: number
    name: string | null
    place: string | null
    /** 出金元の口座名（Web版の表記のまま）。 */
    accountName: string
    /** Zaimでの分類名（Web版の一覧の表示のまま）。レシートの商品を家計簿のカテゴリへ寄せる手がかり（#843）。 */
    categoryName: string | null
    genreName: string | null
    comment: string | null
    /** Web版の一覧からは集計対象外かどうかを読めないので、常に true。 */
    active: boolean
    /** 商品別の明細（Web版の取引詳細から読めたときだけ。#663）。 */
    detailItems?: LinkedDetailItem[]
}

/**
 * Web版の明細を整えた結果の内訳（Issue #383）。
 *
 * 「取り込みが0件なのはなぜか」を追えるようにするために、落とした理由まで数える。
 */
export interface WebMoneyMergeBreakdown {
    /** AIDEから読めた明細の総数。 */
    scanned: number
    /** 支出として残した件数。 */
    merged: number
    /** 同じ明細idが一覧に二度出たため落とした件数。 */
    duplicate: number
    /** 明細idが取れず落とした件数。**二重登録を防げないため取り込みの対象にできない。** */
    noId: number
    /** 支出ではない（振替・収入）ため落とした件数。 */
    notPayment: number
}

export interface WebMoneyMergeResult {
    entries: WebMoneyEntry[]
    breakdown: WebMoneyMergeBreakdown
}

/**
 * Web版の明細を、取り込みが読む `WebMoneyEntry` へ変換する。支出（出金元だけが埋まった行）だけを残す。
 *
 * `active` は必ず `true` にする。Web版の一覧からは集計対象外かどうかを読めないため（AIDEが返す項目に無い）。
 */
export function toWebMoneyEntries(webEntries: readonly ZaimAideMoneyEntry[]): WebMoneyMergeResult {
    const breakdown: WebMoneyMergeBreakdown = {
        scanned: webEntries.length,
        merged: 0,
        duplicate: 0,
        noId: 0,
        notPayment: 0,
    }

    const entries: WebMoneyEntry[] = []
    const seen = new Set<number>()

    for (const web of webEntries) {
        if (web.id === null) {
            breakdown.noId += 1
            continue
        }
        if (seen.has(web.id)) {
            breakdown.duplicate += 1
            continue
        }
        // 振替は出金元と振込先の両方が埋まる。支出だけを取り込みの対象にする。
        if (!web.account || web.toAccount) {
            breakdown.notPayment += 1
            continue
        }

        seen.add(web.id)
        breakdown.merged += 1
        entries.push({
            id: web.id,
            date: web.date,
            amount: web.amount,
            name: web.name || null,
            place: web.place || null,
            accountName: web.account,
            categoryName: web.category || null,
            genreName: web.genre || null,
            comment: web.comment || null,
            active: true,
            ...(web.items ? { detailItems: web.items } : {}),
        })
    }

    return { entries, breakdown }
}

/** AIDEから届いた明細の日付の範囲（`YYYY-MM-DD`）。 */
export interface WebEntryDateRange {
    from: string
    to: string
}

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * AIDEから届いた明細の最古日・最新日を返す（Issue #597）。**純粋関数。**
 *
 * 巡回が一覧の表示行しか読めていなかった頃（#593・aide#481）は、2か月ぶん読んだはずが
 * 直近2〜3日の明細しか届いていなかった。件数だけでは多いのか少ないのか分からないため、
 * 期間を画面に出して「その期間の外の明細は出ない」ことを見えるようにする。
 * 日付だけの値なので `Date` を通さず文字列のまま比べる（CLAUDE.md #443）。
 */
export function summarizeWebEntryDateRange(
    entries: readonly Pick<ZaimAideMoneyEntry, "date">[]
): WebEntryDateRange | null {
    let from: string | null = null
    let to: string | null = null
    for (const { date } of entries) {
        if (!DAY_KEY_PATTERN.test(date)) continue
        if (from === null || date < from) from = date
        if (to === null || date > to) to = date
    }
    return from !== null && to !== null ? { from, to } : null
}

/** `2026-09-24` → `9/24`。年は同じ画面で見る限り不要。 */
function formatDayKey(day: string): string {
    const [, month, date] = day.split("-")
    return `${Number(month)}/${Number(date)}`
}

/** 期間を「9/22〜9/26」の形にする。1日だけならその日だけを返す。 */
export function formatWebEntryDateRange(range: WebEntryDateRange): string {
    const from = formatDayKey(range.from)
    return range.from === range.to ? from : `${from}〜${formatDayKey(range.to)}`
}
