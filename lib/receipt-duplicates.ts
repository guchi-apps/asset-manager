/**
 * 家計簿連携の明細のうち、同じ支払いが別の経路からも記録されていそうな組を探す（Issue #445）。
 *
 * 同じ支払いは、Gmailのカード利用通知・car-careの給油記録・スマートレシート・Amazon・
 * Zaimアプリでの手入力と、複数の経路から届くことがある。ここでは**候補を並べるだけ**で、
 * どちらを残すかは人が決める（削除は既存の「違う（削除）」、別の支払いなら「重複ではない」）。
 *
 * ここは純粋な判定だけを置く。DBもZaim APIも触らない（テストで固定できるようにするため）。
 *
 * **Issue #443 の「置き換え候補」とは別物。** あちらは「反映待ち」の明細が置き換える相手
 * （カードの連携明細）を探し、こちらは消すべき二重の記録を探す。日付の幅と、当アプリが
 * 登録した明細の印は同じものを使う。
 */

import { normalizeStoreName } from "./receipt-normalize"
import { isBeforeZaimRegister, receiptFlowStep } from "./receipt-flow"
import { OWN_REGISTRATION_COMMENT_PREFIX, REPLACE_TARGET_WINDOW_DAYS } from "./replace-target"

/**
 * 購入日の前後何日までを重複の候補にするか。カード利用通知の日付と購入日は数日ずれることがあるため、
 * 置き換え候補（#443）と同じ幅にする。
 */
export const DUPLICATE_WINDOW_DAYS = REPLACE_TARGET_WINDOW_DAYS

/**
 * 「重複ではない」と記録した組を `ExternalPaymentImport` に置くときの `source`。
 * 削除した連携明細の記録（`DELETED_LINKED_IMPORT_SOURCE`、#431）と同じく、テーブルを増やさないための流用。
 */
export const DUPLICATE_DISMISSED_SOURCE = "receipt-duplicate-dismissed"

/** 照合に使う取り込み1件ぶん。 */
export interface DuplicateReceiptInput {
    id: number
    source: string
    status: string
    storeName: string | null
    /** 購入日（YYYY-MM-DD、JST）。 */
    purchasedDate: string | null
    totalAmount: number | null
    /** 取り込み元のZaim明細id（スマートレシート・Amazon由来）。Zaim側の照合で自分自身を外すのに使う。 */
    sourceZaimMoneyIds: number[]
}

/** 照合に使うZaim明細1件ぶん（公式APIの `GET /home/money` の支出）。 */
export interface DuplicateZaimInput {
    id: number
    /** YYYY-MM-DD（JST）。 */
    date: string
    amount: number
    place: string
    name: string
    accountId: number | null
    comment: string
}

export type DuplicateCounterpart =
    | {
          kind: "receipt"
          key: string
          receiptId: number
          source: string
          status: string
          storeName: string | null
          date: string
          amount: number
      }
    | {
          kind: "zaim"
          key: string
          /** 同じ日・同じ口座・同じ店の明細を合算したときは複数になる。 */
          moneyIds: number[]
          accountId: number | null
          place: string | null
          name: string | null
          date: string
          amount: number
      }

export interface DuplicateMatch {
    counterpart: DuplicateCounterpart
    /** 店舗名も一致したか。 */
    sameStore: boolean
    /** 購入日の差（日）。 */
    dayGap: number
    /** 「重複ではない」を記録するときのキー（`dismissKey`）。 */
    dismissKey: string
}

const DAY_MS = 86_400_000

function dayNumber(date: string | null): number | null {
    if (!date) return null
    const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
    if (!matched) return null
    return Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3])) / DAY_MS
}

/** 店舗名が一致するか。表記の揺れ（「イオン西新井店」と「イオン西新井」）は片方が他方を含めば一致とみなす。 */
export function isSameStore(a: string | null | undefined, b: string | null | undefined): boolean {
    const left = normalizeStoreName(a)
    const right = normalizeStoreName(b)
    if (!left || !right) return false
    return left.includes(right) || right.includes(left)
}

/**
 * 金額が同じ2件を重複の候補にするか。**同じ日なら店舗名を問わない**（カード利用通知の加盟店名は
 * 「ENEOS」、給油記録は「エネオス 西新井店」のように表記が揃わない）。日がずれるときは、
 * 別の買い物を拾いすぎないよう店舗名も一致したものだけにする。
 */
function judge(
    date: string | null,
    otherDate: string,
    storeName: string | null,
    otherStore: string | null
): { sameStore: boolean; dayGap: number } | null {
    const left = dayNumber(date)
    const right = dayNumber(otherDate)
    if (left === null || right === null) return null
    const dayGap = Math.abs(left - right)
    if (dayGap > DUPLICATE_WINDOW_DAYS) return null
    const sameStore = isSameStore(storeName, otherStore)
    if (dayGap > 0 && !sameStore) return null
    return { sameStore, dayGap }
}

export function receiptPairKey(a: number, b: number): string {
    return "receipt:" + Math.min(a, b) + "-" + Math.max(a, b)
}

export function zaimPairKey(receiptId: number, moneyIds: readonly number[]): string {
    return "zaim:" + receiptId + "-" + [...moneyIds].sort((x, y) => x - y).join("+")
}

/** 「重複ではない」の記録に使うキー。取り込み同士の組はどちらから押しても同じキーになる。 */
export function dismissKey(receiptId: number, counterpart: DuplicateCounterpart): string {
    return counterpart.kind === "receipt"
        ? receiptPairKey(receiptId, counterpart.receiptId)
        : zaimPairKey(receiptId, counterpart.moneyIds)
}

/** 重複の印を付ける対象か。手順（確認・反映待ち・反映）に載っている明細だけ。 */
function isFlaggable(status: string): boolean {
    const step = receiptFlowStep(status)
    return step !== null && step !== "done"
}

interface ZaimCandidate {
    moneyIds: number[]
    date: string
    amount: number
    accountId: number | null
    place: string | null
    name: string | null
}

/**
 * Zaim明細を照合の相手にする形へ整える。
 *
 * - 当アプリが登録した明細（コメントの印）は外す。取り込み同士の照合で既に見ている
 * - 取り込み元のZaim明細（`sourceZaimMoneyIds`）も外す。自分自身と一致してしまう
 * - 置き換え済みの明細は商品ごとに分かれるため、同じ日・同じ口座・同じ店の明細を合算した組も相手にする
 */
export function buildZaimCandidates(
    entries: readonly DuplicateZaimInput[],
    ownMoneyIds: ReadonlySet<number>
): { singles: ZaimCandidate[]; groups: ZaimCandidate[] } {
    const usable = entries.filter(
        (entry) =>
            entry.amount > 0 &&
            !ownMoneyIds.has(entry.id) &&
            !entry.comment.startsWith(OWN_REGISTRATION_COMMENT_PREFIX)
    )
    const singles = usable.map((entry) => ({
        moneyIds: [entry.id],
        date: entry.date,
        amount: entry.amount,
        accountId: entry.accountId,
        place: entry.place || null,
        name: entry.name || null,
    }))

    const grouped = new Map<string, ZaimCandidate>()
    for (const entry of usable) {
        const store = normalizeStoreName(entry.place)
        if (!store) continue
        const key = entry.date + "|" + (entry.accountId ?? "") + "|" + store
        const group = grouped.get(key)
        if (group) {
            group.moneyIds.push(entry.id)
            group.amount += entry.amount
        } else {
            grouped.set(key, {
                moneyIds: [entry.id],
                date: entry.date,
                amount: entry.amount,
                accountId: entry.accountId,
                place: entry.place || null,
                name: null,
            })
        }
    }
    const groups = [...grouped.values()].filter((group) => group.moneyIds.length > 1)
    return { singles, groups }
}

export interface FindDuplicatesInput {
    /** 印を付ける明細と、その相手になりうる明細（置き換え済みを含む）。 */
    receipts: readonly DuplicateReceiptInput[]
    /** Zaimの明細。読めなかったときは null（取り込み同士だけで照合する）。 */
    zaimEntries: readonly DuplicateZaimInput[] | null
    /** 「重複ではない」と記録した組のキー。 */
    dismissedKeys: ReadonlySet<string>
    /** 印を付ける明細を絞る。省くと手順に載っている明細すべて。 */
    targetIds?: ReadonlySet<number>
}

/**
 * 明細id → 重複の候補。候補の無い明細はキーごと含めない。
 *
 * **Zaim明細との照合は、まだ登録していない（確認の手順の）明細だけ。** 登録済みの明細は
 * Zaim側にある自分自身と一致してしまうため。
 */
export function findReceiptDuplicates(input: FindDuplicatesInput): Record<number, DuplicateMatch[]> {
    const ownMoneyIds = new Set(input.receipts.flatMap((receipt) => receipt.sourceZaimMoneyIds))
    const zaim = input.zaimEntries ? buildZaimCandidates(input.zaimEntries, ownMoneyIds) : null
    const result: Record<number, DuplicateMatch[]> = {}

    for (const receipt of input.receipts) {
        if (!isFlaggable(receipt.status)) continue
        if (input.targetIds && !input.targetIds.has(receipt.id)) continue
        const amount = receipt.totalAmount
        if (amount === null || amount <= 0 || !receipt.purchasedDate) continue

        const matches: DuplicateMatch[] = []
        const push = (counterpart: DuplicateCounterpart, verdict: { sameStore: boolean; dayGap: number }) => {
            const key = dismissKey(receipt.id, counterpart)
            if (input.dismissedKeys.has(key)) return
            matches.push({ counterpart, ...verdict, dismissKey: key })
        }

        for (const other of input.receipts) {
            if (other.id === receipt.id || other.totalAmount !== amount || !other.purchasedDate) continue
            const verdict = judge(receipt.purchasedDate, other.purchasedDate, receipt.storeName, other.storeName)
            if (!verdict) continue
            push(
                {
                    kind: "receipt",
                    key: "receipt:" + other.id,
                    receiptId: other.id,
                    source: other.source,
                    status: other.status,
                    storeName: other.storeName,
                    date: other.purchasedDate,
                    amount,
                },
                verdict
            )
        }

        // Zaimの明細との重複は、まだZaimへ登録していない明細（確認・反映待ち）だけで見る（#466）。
        if (zaim && isBeforeZaimRegister(receipt.status)) {
            // 合算は必ず構成する1件より大きいので、1件での一致と重なることはない。
            for (const candidate of [...zaim.singles, ...zaim.groups]) {
                if (candidate.amount !== amount) continue
                const verdict = judge(
                    receipt.purchasedDate,
                    candidate.date,
                    receipt.storeName,
                    candidate.place ?? candidate.name
                )
                if (!verdict) continue
                push(
                    {
                        kind: "zaim",
                        key: "zaim:" + candidate.moneyIds.join("+"),
                        moneyIds: candidate.moneyIds,
                        accountId: candidate.accountId,
                        place: candidate.place,
                        name: candidate.name,
                        date: candidate.date,
                        amount,
                    },
                    verdict
                )
            }
        }

        if (matches.length === 0) continue
        matches.sort(
            (a, b) =>
                Number(b.sameStore) - Number(a.sameStore) ||
                a.dayGap - b.dayGap ||
                a.counterpart.key.localeCompare(b.counterpart.key)
        )
        result[receipt.id] = matches
    }

    return result
}
