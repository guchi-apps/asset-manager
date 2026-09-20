/**
 * 置き換えできない連携明細（銀行・デビット）へ書き込むメモの下書きを作る（Issue #514）。**純粋関数だけを置く**
 * （クライアント側の文字数表示からも読むため）。
 *
 * Zaimの「置き換え」はカード・電子マネーの連携明細にしか効かない（`lib/zaim-account-kind.ts`）。
 * 銀行・デビットの明細はアプリの明細で置き換えられないので、代わりに**その連携明細のメモへ
 * 買った物を書き込む**。書き込む文面はここで組み立て、人が直してから送る。
 *
 * **Zaimのメモは100文字まで**（AIDE側 `write.ts` の `MAX_TEXT_LENGTH` と同じ。超えるとZaimが
 * 受け付けない）。品目が多ければ入るところまで並べ、残りは「ほかN件」にする。
 */

/** Zaimのメモの上限（文字）。AIDE側の `MAX_TEXT_LENGTH` と同じ値。 */
export const ZAIM_MEMO_MAX_LENGTH = 100

/** 品目の区切り。読点より詰まって見え、店舗名の中点と紛れない。 */
const SEPARATOR = "／"

export interface MemoDraftItem {
    /** レシートに印字されていた名前（`ReceiptItem.rawName`）。 */
    name: string
    quantity: number
    /** 値引き適用後の支払額（円）。 */
    amount: number
}

/** 空白を1つに詰める。レシートの読み取りは全角空白や連続空白を残すことがある。 */
function tidy(name: string): string {
    return name.replace(/\s+/g, " ").trim()
}

/** 1品目ぶんの表記（例: `牛乳x2 436円`）。数量が1なら数量を出さない。 */
function formatItem(item: MemoDraftItem): string {
    const name = tidy(item.name)
    if (!name) return ""
    const quantity = Number.isFinite(item.quantity) && item.quantity > 1 ? "x" + item.quantity : ""
    return name + quantity + " " + Math.round(item.amount) + "円"
}

/**
 * 品目からメモの下書きを作る。上限に収まらなければ、入るところまで並べて「ほかN件」を付ける。
 *
 * **「ほかN件」まで含めて上限に収める。** 付け足して上限を超えると、Zaimが丸ごと受け付けない。
 * 1品目すら入らないときは、その1品目を上限で切る（空文字を返すと人が書く手がかりが残らない）。
 */
export function buildZaimMemoDraft(
    items: readonly MemoDraftItem[],
    maxLength: number = ZAIM_MEMO_MAX_LENGTH
): string {
    const parts = items.map(formatItem).filter((part) => part !== "")
    if (parts.length === 0) return ""

    const joined = parts.join(SEPARATOR)
    if (joined.length <= maxLength) return joined

    for (let count = parts.length - 1; count >= 1; count--) {
        const rest = parts.length - count
        const text = parts.slice(0, count).join(SEPARATOR) + SEPARATOR + "ほか" + rest + "件"
        if (text.length <= maxLength) return text
    }
    return parts[0].slice(0, maxLength)
}

/**
 * メモ1件ぶんの冪等キー。**本文が変われば変わる**ようにする。
 *
 * AIDE側は同じ `requestId` を受け取ると「処理済み」として何も書き換えない
 * （`lib/zaim-web-genre.ts` の `duplicated`）。明細idだけで作ると、書き直したメモが
 * 黙って捨てられる。同じ本文の押し直しだけを二重送信として弾きたいので、本文を混ぜる。
 */
export function buildZaimMemoRequestId(moneyId: number, comment: string): string {
    return "asset-manager:zaim-memo:" + moneyId + ":" + fnv1a32(comment)
}

/** 依存を増やさずに短い指紋を作るためのFNV-1a（32bit）。衝突しても同じ本文の再送が省かれるだけ。 */
function fnv1a32(text: string): string {
    let hash = 0x811c9dc5
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index)
        hash = Math.imul(hash, 0x01000193) >>> 0
    }
    return hash.toString(16).padStart(8, "0")
}
