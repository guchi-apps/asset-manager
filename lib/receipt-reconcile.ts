/**
 * Zaimのカード連携明細と、当アプリの明細（① 確認・② 反映待ち）を突き合わせる（Issue #456）。
 *
 * 家計簿連携は記録を残すための機能ではなく、Zaimへ記録するときにGmail等の明細を使うための機能。
 * そこで「Zaimに届いたカード明細」と「当アプリにある明細」を1対1の組にして、
 * どちらか片方にしか無いものを見つけやすくする。ここは組を作る**純粋関数**だけを置く。
 *
 * - 照合の条件は置き換え候補（#443）の `findReplaceTargets` と同じ
 *   （金額一致・日付が前後 `REPLACE_TARGET_WINDOW_DAYS` 日以内、同じ口座を優先 → 日付の近い順）
 * - **組を作るときは口座で絞らない**（#443 と同じ。口座名の揺れやマスタの欠けで黙って一致が0件になるため）。
 *   口座は並び順（`sameAccount`）にだけ使う
 * - **Web版の一覧からは「置き換え待ちかどうか」を読めない**（置き換え済みの元明細・手入力の明細も並ぶ。#300）。
 *   そのため「Zaimにだけある」は、突き合わせる口座（明細の登録先・既定のカード）の行だけに絞り、
 *   置き換え済みの明細（`replaced`）とも照合して、済んだ行を「Zaimにだけある」へ出さない
 * - **金額が一致しなかった残りは、近い金額どうしを「金額ずれ」の組にする**（Issue #483）。為替換算した
 *   Gmailの明細などは、カード会社の換算でZaimの金額と数円〜数十円ずれる。組にしたアプリ側の明細は、
 *   Zaim側の金額へ合わせられる。ただし組にすると「Zaimにだけ」「アプリにだけ」から消えるため、
 *   **金額が概算の明細か、同じ口座か、店舗名が似ている明細どうしに限る**（計画レビューの指摘。無関係な2件を
 *   組にして取り込み漏れ・未着を埋もれさせない）。Gmailの取り込みには概算の印が付かないことがあり、
 *   既定のカードがZaimの口座と違うと口座も合わないため、店舗名（Anthropic と ANTHROPIC* CLAU…）で拾う（Issue #487）
 */

import type { ReceiptFlowStep } from "./receipt-flow"
import { COPY_COMMENT_PREFIX } from "./zaim-copy"
import { isSameStore } from "./receipt-duplicates"
import {
    accountKey,
    OWN_REGISTRATION_COMMENT_PREFIX,
    REPLACE_TARGET_WINDOW_DAYS,
    type AccountKindOf,
    type ReplaceSourceEntry,
} from "./replace-target"

/** 何日前までの明細を突き合わせるか。カード明細がZaimへ届くまでの数日と、月末の締めを見越した幅。 */
export const RECONCILE_LOOKBACK_DAYS = 31

/** 「金額ずれ」とみなす差の割合（Zaim側の金額に対して）。Issue #483。 */
export const AMOUNT_GAP_RATIO = 0.05
/** 「金額ずれ」とみなす差の下限（円）。少額の買い物でも数十円の換算差は起きるため、割合と大きいほうを使う。 */
export const AMOUNT_GAP_MIN_YEN = 50

/** 2つの金額が「金額ずれ」とみなせるほど近いか。一致は含めない（一致は先に組にする）。 */
export function isNearAmount(zaimAmount: number, appAmount: number): boolean {
    const diff = Math.abs(zaimAmount - appAmount)
    if (diff === 0) return false
    return diff <= Math.max(Math.abs(zaimAmount) * AMOUNT_GAP_RATIO, AMOUNT_GAP_MIN_YEN)
}

export interface ReconcileReceipt {
    id: number
    /**
     * `review` は① 確認、`waiting` は② 反映待ち、`reflect` は③ 反映（`lib/receipt-flow.ts` と同じ。#466）、
     * `replaced` は置き換え済み。
     * 置き換え済みは照合の相手にするだけで、組にしても結果には出さない（#456）。
     */
    step: ReceiptFlowStep | "replaced"
    source: string
    storeName: string | null
    /** 購入日（YYYY-MM-DD、JST）。 */
    purchasedDate: string | null
    totalAmount: number | null
    itemCount: number
    /** 登録先（未登録なら登録予定）のカード名。分からなければ null。 */
    cardAccountName: string | null
    /** 取り込んだ金額が概算か（為替換算など。Issue #483）。 */
    amountApproximate?: boolean
    /** 金額が不確かな理由。 */
    amountNote?: string | null
}

export interface ReconcileEntry {
    id: number | null
    date: string
    amount: number
    account: string
    place: string | null
    name: string | null
}

/**
 * - `matched`: 両方にある
 * - `zaimOnly`: Zaimのカード明細はあるが、当アプリに明細が無い（Gmail等の取り込み待ち・手入力が要る）
 * - `appOnly`: 当アプリに明細はあるが、Zaimにカード明細がまだ無い
 * - `amountGap`: 日付は合うが金額が少しずれている（Issue #483）。アプリ側をZaimの金額へ合わせられる
 */
export type ReconcileKind = "matched" | "amountGap" | "zaimOnly" | "appOnly"

/** 結果に出す明細。置き換え済みは出さない。 */
export type ReconcileShownReceipt = ReconcileReceipt & { step: ReceiptFlowStep }

export interface ReconcilePair {
    kind: ReconcileKind
    entry: ReconcileEntry | null
    receipt: ReconcileShownReceipt | null
    /** 組の日付のずれ（日）。一致したときだけ。 */
    dayGap: number | null
    /** Zaim明細の口座が、明細の登録先カードと同じか。一致したときだけ意味を持つ。 */
    sameAccount: boolean
    /** 金額の差（Zaim − アプリ）。「金額ずれ」のときだけ。 */
    amountDiff: number | null
}

export interface ReconcileOptions {
    /** 突き合わせる口座の名前（マスタの表記）。これ以外の口座のZaim明細は「Zaimにだけある」に出さない。 */
    accountNames: readonly string[]
    /** この日（YYYY-MM-DD）以降のZaim明細・明細だけを見る。 */
    fromDate: string
    /** AIDEが読んだ月（`YYYYMM`）。前後の日付が読めていない明細は「アプリにだけ」と言い切れないので外す。 */
    coveredMonths: readonly string[]
    /** 今日（YYYY-MM-DD、JST）。これより後の日付は、月が読めていなくても判定の妨げにしない。 */
    today: string
    /**
     * 明細id → 組にしないZaim明細id。① 確認の明細で「重複の可能性」（#445）に出た相手を渡す。
     * 同じZaim明細に「重複（消すべき二重の記録）」と「一致（登録してよい）」の逆の印を付けないため（#451）。
     * ここに出たZaim明細は手入力の明細なので、「Zaimにだけある」にも出さない。
     */
    excludedPairs?: ReadonlyMap<number, ReadonlySet<number>>
    /**
     * 口座名 → 種別（Issue #471）。手入力・反映待ちの口座の行は連携明細ではないので、組にも
     * 「Zaimにだけある」にも出さない（`findReplaceTargets` と同じ規則）。
     */
    kindOf?: AccountKindOf
}

export interface ReconcileResult {
    pairs: ReconcilePair[]
    /** 日付・金額が無い、または前後がAIDEの読んだ月に入らず、判定できなかった明細の数。 */
    uncheckedCount: number
}

const DAY_MS = 86_400_000

function dayNumber(date: string | null): number | null {
    const matched = date ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) : null
    if (!matched) return null
    return Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3])) / DAY_MS
}

function monthKeyOfDayNumber(day: number): string {
    return new Date(day * DAY_MS).toISOString().slice(0, 7).replace("-", "")
}

/** Zaim明細の側で突き合わせの対象にする行か。振替・当アプリが書いた行は外す。 */
function isReconcilableEntry(entry: ReplaceSourceEntry): boolean {
    if (entry.toAccount) return false
    if (entry.comment.startsWith(OWN_REGISTRATION_COMMENT_PREFIX)) return false
    return !entry.comment.startsWith(COPY_COMMENT_PREFIX)
}

function isShown(receipt: ReconcileReceipt): receipt is ReconcileShownReceipt {
    return receipt.step !== "replaced"
}

/**
 * Zaim明細と明細を1対1の組にする。
 *
 * 候補の組をすべて作り、「同じ口座 → 日付の近い順」に貪欲に確定させる。1件のZaim明細を
 * 2件の明細へ割り当てない（同じ金額の買い物が続いたとき、片方は「アプリにだけ」に残す）。
 * 置き換え済みの明細と組になったZaim明細は、済んだものとして結果から外す。
 * 並びは 一致 → 金額ずれ → Zaimにだけ → アプリにだけ、それぞれ日付の新しい順。
 */
export function reconcileReceipts(
    entries: readonly ReplaceSourceEntry[],
    receipts: readonly ReconcileReceipt[],
    options: ReconcileOptions
): ReconcileResult {
    const from = dayNumber(options.fromDate) ?? Number.NEGATIVE_INFINITY
    const accountKeys = new Set(options.accountNames.map(accountKey))
    const covered = new Set(options.coveredMonths)
    const today = dayNumber(options.today) ?? Number.POSITIVE_INFINITY

    const zaim = entries.flatMap((entry) => {
        const day = dayNumber(entry.date)
        if (day === null || day < from || !isReconcilableEntry(entry)) return []
        const kind = options.kindOf?.(entry.account) ?? null
        if (kind === "MANUAL" || kind === "PENDING") return []
        return [{ entry, day, inScope: accountKeys.has(accountKey(entry.account)) }]
    })

    let uncheckedCount = 0
    const apps = receipts.flatMap((receipt) => {
        const day = dayNumber(receipt.purchasedDate)
        // 置き換え済みは、期間の手前でも日付のずれの分だけ期間内のZaim明細の相手になりうる。
        const earliest = isShown(receipt) ? from : from - REPLACE_TARGET_WINDOW_DAYS
        if (day !== null && day < earliest) return []
        if (day === null || receipt.totalAmount === null) {
            if (isShown(receipt)) uncheckedCount++
            return []
        }
        return [{ receipt, day, amount: receipt.totalAmount }]
    })

    const candidates: Array<{ z: number; a: number; gap: number; sameAccount: boolean }> = []
    zaim.forEach((z, zi) => {
        apps.forEach((a, ai) => {
            if (z.entry.amount !== a.amount) return
            if (z.entry.id !== null && options.excludedPairs?.get(a.receipt.id)?.has(z.entry.id)) return
            const gap = Math.abs(z.day - a.day)
            if (gap > REPLACE_TARGET_WINDOW_DAYS) return
            const sameAccount =
                a.receipt.cardAccountName !== null &&
                accountKey(a.receipt.cardAccountName) === accountKey(z.entry.account)
            candidates.push({ z: zi, a: ai, gap, sameAccount })
        })
    })
    candidates.sort(
        (x, y) =>
            Number(y.sameAccount) - Number(x.sameAccount) ||
            x.gap - y.gap ||
            zaim[x.z].day - zaim[y.z].day
    )

    const usedZaim = new Set<number>()
    const usedApp = new Set<number>()
    const matched: Array<{ pair: ReconcilePair; sortDay: number }> = []
    for (const candidate of candidates) {
        if (usedZaim.has(candidate.z) || usedApp.has(candidate.a)) continue
        usedZaim.add(candidate.z)
        usedApp.add(candidate.a)
        const receipt = apps[candidate.a].receipt
        if (!isShown(receipt)) continue
        matched.push({
            pair: {
                kind: "matched",
                entry: toEntry(zaim[candidate.z].entry),
                receipt,
                dayGap: candidate.gap,
                sameAccount: candidate.sameAccount,
                amountDiff: null,
            },
            sortDay: zaim[candidate.z].day,
        })
    }

    // 金額が一致しなかった残りから、近い金額の組を作る（Issue #483）。置き換え済みは相手にしない。
    const gapCandidates: Array<{
        z: number
        a: number
        gap: number
        sameAccount: boolean
        approximate: boolean
        sameStore: boolean
        ratio: number
    }> = []
    zaim.forEach((z, zi) => {
        if (usedZaim.has(zi)) return
        apps.forEach((a, ai) => {
            if (usedApp.has(ai) || !isShown(a.receipt)) return
            if (!isNearAmount(z.entry.amount, a.amount)) return
            if (z.entry.id !== null && options.excludedPairs?.get(a.receipt.id)?.has(z.entry.id)) return
            const gap = Math.abs(z.day - a.day)
            if (gap > REPLACE_TARGET_WINDOW_DAYS) return
            const sameAccount =
                a.receipt.cardAccountName !== null &&
                accountKey(a.receipt.cardAccountName) === accountKey(z.entry.account)
            const approximate = a.receipt.amountApproximate === true
            // Zaim側の店名は、加盟店名（place）か品名（name）のどちらかに入る。
            const sameStore =
                isSameStore(a.receipt.storeName, z.entry.place) || isSameStore(a.receipt.storeName, z.entry.name)
            if (!approximate && !sameAccount && !sameStore) return
            const ratio = Math.abs(z.entry.amount - a.amount) / Math.max(Math.abs(z.entry.amount), 1)
            gapCandidates.push({ z: zi, a: ai, gap, sameAccount, approximate, sameStore, ratio })
        })
    })
    gapCandidates.sort(
        (x, y) =>
            Number(y.approximate) - Number(x.approximate) ||
            Number(y.sameAccount) - Number(x.sameAccount) ||
            Number(y.sameStore) - Number(x.sameStore) ||
            x.ratio - y.ratio ||
            x.gap - y.gap
    )
    const amountGap: Array<{ pair: ReconcilePair; sortDay: number }> = []
    for (const candidate of gapCandidates) {
        if (usedZaim.has(candidate.z) || usedApp.has(candidate.a)) continue
        usedZaim.add(candidate.z)
        usedApp.add(candidate.a)
        const receipt = apps[candidate.a].receipt as ReconcileShownReceipt
        const zaimEntry = zaim[candidate.z].entry
        amountGap.push({
            pair: {
                kind: "amountGap",
                entry: toEntry(zaimEntry),
                receipt,
                dayGap: candidate.gap,
                sameAccount: candidate.sameAccount,
                amountDiff: zaimEntry.amount - apps[candidate.a].amount,
            },
            sortDay: zaim[candidate.z].day,
        })
    }

    const duplicateIds = new Set(
        [...(options.excludedPairs?.values() ?? [])].flatMap((ids) => [...ids])
    )
    const zaimOnly = zaim.flatMap((z, index) =>
        usedZaim.has(index) || !z.inScope || (z.entry.id !== null && duplicateIds.has(z.entry.id))
            ? []
            : [
                  {
                      pair: {
                          kind: "zaimOnly" as const,
                          entry: toEntry(z.entry),
                          receipt: null,
                          dayGap: null,
                          sameAccount: false,
                          amountDiff: null,
                      },
                      sortDay: z.day,
                  },
              ]
    )

    const appOnly = apps.flatMap((a, index) => {
        const receipt = a.receipt
        if (usedApp.has(index) || !isShown(receipt)) return []
        // 前後の日付がAIDEの読んだ月に入っていなければ、Zaimに無いとは言い切れない。
        for (let offset = -REPLACE_TARGET_WINDOW_DAYS; offset <= REPLACE_TARGET_WINDOW_DAYS; offset++) {
            const day = a.day + offset
            if (day <= today && !covered.has(monthKeyOfDayNumber(day))) {
                uncheckedCount++
                return []
            }
        }
        return [
            {
                pair: {
                    kind: "appOnly" as const,
                    entry: null,
                    receipt,
                    dayGap: null,
                    sameAccount: false,
                    amountDiff: null,
                },
                sortDay: a.day,
            },
        ]
    })

    const byNewest = (x: { sortDay: number }, y: { sortDay: number }) => y.sortDay - x.sortDay
    const pairs = [matched, amountGap, zaimOnly, appOnly].flatMap((group) =>
        [...group].sort(byNewest).map((item) => item.pair)
    )
    return { pairs, uncheckedCount }
}

function toEntry(entry: ReplaceSourceEntry): ReconcileEntry {
    return {
        id: entry.id,
        date: entry.date,
        amount: entry.amount,
        account: entry.account,
        place: entry.place || null,
        name: entry.name || null,
    }
}
