/**
 * Zaim口座の種別（Issue #471）。**純粋関数だけを置く**（クライアント側からも読むため）。
 *
 * Zaimの「置き換え」ができるのは、自動連携したクレジットカード・電子マネーの明細だけで、
 * **銀行口座・デビットカード・ショッピングサイトの連携明細は対象外**（公式「対象となる履歴」。
 * `docs/receipt-import.md`「置き換えの成立条件と検証」）。銀行口座の連携明細に届いたGmail等の明細を
 * 「反映待ち」口座へ登録すると、置き換えられないまま同じ支払いが二重に残る。
 *
 * **Zaim APIの口座マスタ（`/v2/home/account`）は口座の種類を返さない**（id・name・sort・activeだけ）。
 * そのため、口座名の語とAIDEの残高一覧（連携しているか・残高の符号）から推定し、外れたら人が選び直す。
 */

import type { ZaimAccountKind } from "@prisma/client"

import { accountKey, PENDING_ACCOUNT_NAME, type ReplaceTargetLookup } from "./replace-target"
import { normalizeMasterName } from "./zaim-web-entries"

export type AccountKind = ZaimAccountKind

/** 画面で選べる順。反映待ちは口座名で決まるので選択肢には出さない。 */
export const SELECTABLE_ACCOUNT_KINDS: AccountKind[] = ["CARD", "BANK", "MANUAL", "OTHER"]

export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = {
    CARD: "カード・電子マネー",
    BANK: "銀行・デビット",
    MANUAL: "手入力",
    PENDING: "反映待ち",
    OTHER: "対象外",
}

/** 選択肢の説明。設定カードの凡例に出す。 */
export const ACCOUNT_KIND_HINT: Record<AccountKind, string> = {
    CARD: "連携明細をアプリの明細で置き換える",
    BANK: "置き換えできない。連携明細で済ませる",
    MANUAL: "連携明細は届かない。置き換える側の明細",
    PENDING: "アプリの明細の登録先",
    OTHER: "証券・ポイント・Amazon等の連携サービス",
}

/**
 * 推定の手がかり。AIDEの残高一覧（`ZaimBalance`）から作る。
 *
 * - `linked`: Zaim側が金融機関から取得した時刻があるか（連携口座か）。一覧に無ければ null
 * - `negative`: 残高がマイナスか。Zaimはクレジットカードの残高をマイナスで返す（`lib/zaim-aide.ts`）
 */
export interface AccountKindClue {
    linked: boolean | null
    negative: boolean | null
}

// 並びが判定の優先順になる。「デビットカード」は「カード」より先に銀行へ寄せる。
const DEBIT_PATTERN = /デビット|debit/i
const CARD_PATTERN = /カード|card|visa|jcb|master|amex|アメックス|ダイナース|diners/i
const OTHER_PATTERN =
    /証券|ポイント|point|マイル|amazon|アマゾン|スマートレシート|楽天市場|yahoo|ヤフー|nisa|idec|年金|保険|確定拠出/i
const EMONEY_PATTERN =
    /suica|pasmo|icoca|nanaco|waon|edy|quicpay|paypay|pay$|ペイ$|払い|メルペイ|au\s*pay/i
const BANK_PATTERN = /銀行|信金|信用金庫|信用組合|労金|ゆうちょ|bank|バンク|jaバンク/i
const MANUAL_PATTERN = /現金|財布|さいふ|サイフ|wallet|手入力|手元/i

/**
 * 口座名と手がかりから種別を推定する。決めきれなければ null（＝カード扱いのまま）。
 *
 * **名前の語を連携の有無より優先する。** 連携の有無は「手入力か」を見分ける材料にしかならず、
 * 銀行とカードの区別は名前か残高の符号でしか付かない。
 */
export function guessAccountKind(name: string, clue: AccountKindClue): AccountKind | null {
    const text = normalizeMasterName(name)
    if (text === PENDING_ACCOUNT_NAME) return "PENDING"
    if (DEBIT_PATTERN.test(text)) return "BANK"
    if (CARD_PATTERN.test(text)) return "CARD"
    if (OTHER_PATTERN.test(text)) return "OTHER"
    if (EMONEY_PATTERN.test(text)) return "CARD"
    if (BANK_PATTERN.test(text)) return "BANK"
    if (clue.linked === false) return "MANUAL"
    if (MANUAL_PATTERN.test(text)) return "MANUAL"
    if (clue.linked === true && clue.negative === true) return "CARD"
    return null
}

/**
 * 連携明細を置き換えられる口座か。**種別が分からない（null）ときは置き換えられるものとして扱う**
 * （#471 より前と同じ動きにし、推定が外れた・未設定の口座で登録の導線を塞がないため）。
 */
export function isReplaceableKind(kind: AccountKind | null | undefined): boolean {
    return kind !== "BANK"
}

/**
 * 連携明細の候補に出してよい口座か。手入力・反映待ちの口座の明細は人やアプリが入れたもので、
 * 置き換える相手（連携明細）ではない。
 */
export function isLinkedEntryKind(kind: AccountKind | null | undefined): boolean {
    return kind !== "MANUAL" && kind !== "PENDING"
}

/** 口座名（Web版の表記のまま）→ 種別。表記の揺れは `accountKey` で吸収する。 */
export type AccountKindLookup = (accountName: string) => AccountKind | null

export function buildAccountKindLookup(
    accounts: ReadonlyArray<{ name: string; kind: AccountKind | null }>
): AccountKindLookup {
    const byKey = new Map<string, AccountKind>()
    for (const account of accounts) {
        if (account.kind) byKey.set(accountKey(account.name), account.kind)
    }
    return (accountName) => (accountName ? (byKey.get(accountKey(accountName)) ?? null) : null)
}

/**
 * AIDEの残高一覧から、口座名 → 手がかりを引く関数を作る。一覧に無い口座は両方 null。
 */
export function buildAccountKindClues(
    balances: ReadonlyArray<{ name: string; amount: number; lastUpdatedAt: string | null }> | null
): (name: string) => AccountKindClue {
    const byKey = new Map<string, AccountKindClue>()
    for (const balance of balances ?? []) {
        byKey.set(accountKey(balance.name), {
            linked: balance.lastUpdatedAt !== null,
            negative: balance.amount < 0,
        })
    }
    return (name) => byKey.get(accountKey(name)) ?? { linked: null, negative: null }
}

/**
 * 見つかった連携明細が、どれも置き換えられない口座（銀行・デビット）のものか（Issue #471）。
 * 1件でもカードなど置き換えられる口座の候補があれば false（従来どおり「Zaimへ登録」を出す）。
 */
export function isUnreplaceableLookup(lookup: ReplaceTargetLookup | null | undefined): boolean {
    if (!lookup || lookup.state !== "found") return false
    return lookup.targets.every((target) => !isReplaceableKind(target.accountKind))
}
