/**
 * 家計簿の口座の結合（Issue #973）。DBに触らない純粋な関数だけを置く。
 *
 * 二重に作った口座などを1つにまとめる。結合元（source）を指す取引・支払いを結合先（target）へ付け替え、結合元を消す。
 * - 結合元と結合先のあいだの振替は、付け替えると同じ口座どうしになるので取引ごと消す
 * - 支払いを分けた支出（#944）で両方に支払いがあるものは1行に合算し、1行だけになったら分けるのをやめる
 * - 結合先の初期残高は、結合の前後で「2口座の残高の合計」が変わらないように決め直す（基準日は結合先のまま）
 *
 * DBへの書き込みは `lib/ledger-service.ts` の `mergeAccount`。経緯は `docs/ledger-account-merge.md`。
 */
import { computeBalance, type BalanceAccount, type BalanceEntry } from "@/lib/ledger-balance"
import type { PaymentPart } from "@/lib/ledger-payments"

export type MergeEntryPlan =
    /** 結合元と結合先のあいだの振替。付け替えると同じ口座どうしになるので消す */
    | { action: "delete" }
    /** 付け替える。`payments` が空なら分けていない取引（または分けるのをやめた取引） */
    | { action: "remap"; fromAccountId: number | null; toAccountId: number | null; payments: PaymentPart[] }

/** 1件の取引を、結合元から結合先へ付け替えたあとの形にする */
export function planEntryMerge(entry: BalanceEntry, sourceId: number, targetId: number): MergeEntryPlan {
    const swap = (id: number | null) => (id === sourceId ? targetId : id)
    const fromAccountId = swap(entry.fromAccountId)
    const toAccountId = swap(entry.toAccountId)
    if (fromAccountId !== null && fromAccountId === toAccountId) return { action: "delete" }

    const payments: PaymentPart[] = []
    for (const p of entry.payments ?? []) {
        const accountId = p.accountId === sourceId ? targetId : p.accountId
        const same = payments.find((q) => q.accountId === accountId)
        if (same) same.amount += p.amount
        else payments.push({ accountId, amount: p.amount })
    }
    // 1つの口座に合算されたら分けた支払いではなくなる（支払いは2行以上で持つ。#944）。合計は取引の金額と一致している
    if (payments.length === 1) return { action: "remap", fromAccountId: payments[0].accountId, toAccountId, payments: [] }
    return { action: "remap", fromAccountId, toAccountId, payments }
}

export interface MergePlan {
    /** 付け替える取引の件数（結合元に触れる取引のうち、消すもの以外） */
    movedCount: number
    /** 消す取引（結合元と結合先のあいだの振替）の件数 */
    deletedCount: number
    /** 結合後の結合先の初期残高 */
    newOpeningBalance: number
    /** 結合後の結合先の残高（全期間）。結合前の2口座の残高の合計と同じ */
    mergedBalance: number
}

/**
 * 結合の計画。`entries` は結合元・結合先のどちらかに触れる取引をすべて渡す（`id` で重複を見分けない。呼び出し側で1回ずつ渡す）。
 * 結合後の結合先の残高が「結合前の2口座の残高の合計」になるよう、初期残高を決め直す。
 * 結合元の基準日より前の取引が結合先の基準日以降なら数え始め、逆なら数えなくなる。その差を初期残高で吸収する。
 */
export function planAccountMerge(
    source: BalanceAccount,
    target: BalanceAccount,
    entries: readonly BalanceEntry[]
): MergePlan {
    const touches = (e: BalanceEntry, id: number) =>
        e.fromAccountId === id || e.toAccountId === id || (e.payments ?? []).some((p) => p.accountId === id)
    const sourceEntries = entries.filter((e) => touches(e, source.id))
    const targetEntries = entries.filter((e) => touches(e, target.id))
    const mergedBalance = computeBalance(source, sourceEntries) + computeBalance(target, targetEntries)

    let movedCount = 0
    let deletedCount = 0
    const after: BalanceEntry[] = []
    for (const entry of entries) {
        const touchesSource = touches(entry, source.id)
        if (!touchesSource) {
            if (touches(entry, target.id)) after.push(entry)
            continue
        }
        const plan = planEntryMerge(entry, source.id, target.id)
        if (plan.action === "delete") {
            deletedCount += 1
            continue
        }
        movedCount += 1
        after.push({ ...entry, fromAccountId: plan.fromAccountId, toAccountId: plan.toAccountId, payments: plan.payments })
    }
    const counted = computeBalance({ ...target, openingBalance: 0 }, after)
    return { movedCount, deletedCount, newOpeningBalance: mergedBalance - counted, mergedBalance }
}
