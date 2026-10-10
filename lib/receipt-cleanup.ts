/**
 * 取り込んだ詳細明細（メール・外部アプリ等）の整理（Issue #658）。
 *
 * 削除してよいか、Zaimの連携明細にすでに反映されていそうか、を判定する**純粋関数**だけを置く。
 * - **カード明細の存在と、詳細情報の置き換え完了は別物。** 候補を出すだけで、削除は必ず人が決める
 * - **同額だけでは確定しない。** 候補が複数・日付や金額のずれ・店舗名の不一致があれば `check` にする
 * - 取得失敗・古いデータ・取得範囲外では候補を出さず、理由を返す
 */
import type { ReceiptStatus } from "@prisma/client"

import { isSameStore } from "./receipt-duplicates"
import { isNearAmount } from "./receipt-reconcile"
import {
    OWN_REGISTRATION_COMMENT_PREFIX,
    REPLACE_TARGET_WINDOW_DAYS,
    type AccountKindOf,
    type ReplaceSourceEntry,
} from "./replace-target"

/** 購入日の前後何日までを候補に載せるか（確認対象を含む）。 */
export const CLEANUP_CANDIDATE_WINDOW_DAYS = 14

const DAY_MS = 86_400_000

export interface CleanupReceiptInput {
    id: number
    status: ReceiptStatus
    storeName: string | null
    /** YYYY-MM-DD（JST）。 */
    purchasedDate: string | null
    totalAmount: number | null
    matchedCardMoneyId: number | null
    zaimMoneyId: number | null
    sentToZaimAt: Date | null
    zaimRegisterError: string | null
}

export interface DeletableJudgement {
    deletable: boolean
    /** 削除できない理由（画面にそのまま出せる日本語）。 */
    reason: string | null
}

/**
 * 物理削除してよい明細か。登録済み・登録途中・カード対応付け済みは履歴と二重登録防止のため削除させない。
 * `deleteReceipt` も同じ判定を通す。
 */
export function judgeDeletable(
    receipt: Pick<
        CleanupReceiptInput,
        "status" | "matchedCardMoneyId" | "zaimMoneyId" | "sentToZaimAt" | "zaimRegisterError"
    >
): DeletableJudgement {
    if (receipt.status === "SENT_TO_ZAIM" || receipt.status === "REPLACED") {
        return { deletable: false, reason: "Zaimへ登録済みのため削除できません" }
    }
    if (receipt.status === "MANUAL_ACTION_REQUIRED") {
        return {
            deletable: false,
            reason: "Zaimへの登録が途中で止まっているため削除できません。Zaimを確認してから登録し直してください",
        }
    }
    if (
        receipt.zaimMoneyId !== null ||
        receipt.sentToZaimAt !== null ||
        receipt.zaimRegisterError
    ) {
        return { deletable: false, reason: "Zaimへの登録の記録があるため削除できません" }
    }
    if (receipt.matchedCardMoneyId !== null) {
        return {
            deletable: false,
            reason: "カード明細と対応付け済みのため削除できません（対応の履歴を保持します）",
        }
    }
    return { deletable: true, reason: null }
}

export type CleanupCertainty = "likely" | "check"

export interface CleanupCandidate {
    entry: ReplaceSourceEntry
    certainty: CleanupCertainty
    /** 照合理由（人に見せる）。 */
    reasons: string[]
}

export type CleanupState = "found" | "notFound" | "notCovered" | "unknown"

export interface CleanupLookup {
    state: CleanupState
    candidates: CleanupCandidate[]
}

function dayNumber(date: string): number | null {
    const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
    if (!matched) return null
    return Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3])) / DAY_MS
}

function monthKeyOfDayNumber(day: number): string {
    return new Date(day * DAY_MS).toISOString().slice(0, 7).replace("-", "")
}

/** 連携明細として照合の相手にしてよい行か（振替・自アプリの登録・手入力/反映待ち/銀行口座は除く）。 */
function isLinkedEntry(entry: ReplaceSourceEntry, kindOf: AccountKindOf): boolean {
    if (entry.toAccount) return false
    if (entry.amount <= 0) return false
    if (entry.comment.startsWith(OWN_REGISTRATION_COMMENT_PREFIX)) return false
    const kind = kindOf(entry.account)
    return kind !== "MANUAL" && kind !== "PENDING" && kind !== "BANK"
}

interface RawMatch {
    entry: ReplaceSourceEntry
    distance: number
    exact: boolean
    sameStore: boolean
}

function rawMatches(
    receipt: CleanupReceiptInput,
    entries: readonly ReplaceSourceEntry[],
    kindOf: AccountKindOf
): RawMatch[] {
    const purchased = receipt.purchasedDate ? dayNumber(receipt.purchasedDate) : null
    if (purchased === null || receipt.totalAmount === null) return []
    const matches: RawMatch[] = []
    for (const entry of entries) {
        if (!isLinkedEntry(entry, kindOf)) continue
        const exact = entry.amount === receipt.totalAmount
        if (!exact && !isNearAmount(entry.amount, receipt.totalAmount)) continue
        const day = dayNumber(entry.date)
        if (day === null) continue
        const distance = Math.abs(day - purchased)
        if (distance > CLEANUP_CANDIDATE_WINDOW_DAYS) continue
        matches.push({
            entry,
            distance,
            exact,
            sameStore: isSameStore(receipt.storeName, entry.place) || isSameStore(receipt.storeName, entry.name),
        })
    }
    return matches
}

/**
 * 取り込み明細ごとに、Zaimの連携明細の候補を探す。
 *
 * `likely`（反映済みの可能性が高い）にするのは、**すべて**を満たすときだけ。
 * - 金額が一致し、日付が購入日の前後 `REPLACE_TARGET_WINDOW_DAYS` 日以内
 * - 同じ明細を取り合う取り込み明細が他に無い
 * - 条件に合う連携明細がちょうど1件
 * - 店舗名が一致する
 * それ以外（複数候補・金額や日付のずれ・店舗名の不一致・取り合い）は `check`。
 */
export function findCleanupCandidates(
    receipts: readonly CleanupReceiptInput[],
    entries: readonly ReplaceSourceEntry[],
    coveredMonths: readonly string[],
    kindOf: AccountKindOf = () => null
): Record<number, CleanupLookup> {
    const raw = new Map<number, RawMatch[]>()
    for (const receipt of receipts) raw.set(receipt.id, rawMatches(receipt, entries, kindOf))

    // 同じ連携明細を候補にしている取り込み明細の数（同額の別支払いの見分けに使う）。
    const claims = new Map<string, number>()
    const keyOf = (entry: ReplaceSourceEntry) =>
        entry.id !== null ? `id:${entry.id}` : `row:${entry.date}:${entry.amount}:${entry.account}:${entry.place}`
    for (const matches of raw.values()) {
        for (const match of matches) claims.set(keyOf(match.entry), (claims.get(keyOf(match.entry)) ?? 0) + 1)
    }

    const covered = new Set(coveredMonths)
    const result: Record<number, CleanupLookup> = {}
    for (const receipt of receipts) {
        const purchased = receipt.purchasedDate ? dayNumber(receipt.purchasedDate) : null
        if (purchased === null || receipt.totalAmount === null) {
            result[receipt.id] = { state: "unknown", candidates: [] }
            continue
        }
        const matches = (raw.get(receipt.id) ?? []).sort(
            (a, b) => Number(b.exact) - Number(a.exact) || a.distance - b.distance
        )
        if (matches.length === 0) {
            let notCovered = false
            for (let offset = -REPLACE_TARGET_WINDOW_DAYS; offset <= REPLACE_TARGET_WINDOW_DAYS; offset++) {
                if (!covered.has(monthKeyOfDayNumber(purchased + offset))) notCovered = true
            }
            result[receipt.id] = { state: notCovered ? "notCovered" : "notFound", candidates: [] }
            continue
        }
        const strict = matches.filter((m) => m.exact && m.distance <= REPLACE_TARGET_WINDOW_DAYS)
        const candidates = matches.map((match): CleanupCandidate => {
            const reasons: string[] = []
            reasons.push(match.exact ? "金額が一致" : "金額が近い（為替・端数のずれの可能性）")
            reasons.push(match.distance === 0 ? "同じ日付" : `日付が${match.distance}日ずれ`)
            reasons.push(match.sameStore ? "店舗名が一致" : "店舗名は一致しない")
            const rivals = (claims.get(keyOf(match.entry)) ?? 1) - 1
            if (rivals > 0) reasons.push(`同じ連携明細を候補にする別の取り込み明細が${rivals}件あり、同額の別支払いかもしれない`)
            if (strict.length > 1) reasons.push(`条件に合う連携明細が${strict.length}件あり、どれか特定できない`)
            const likely =
                match.exact &&
                match.distance <= REPLACE_TARGET_WINDOW_DAYS &&
                match.sameStore &&
                rivals === 0 &&
                strict.length === 1 &&
                matches.length === 1
            return { entry: match.entry, certainty: likely ? "likely" : "check", reasons }
        })
        result[receipt.id] = { state: "found", candidates }
    }
    return result
}
