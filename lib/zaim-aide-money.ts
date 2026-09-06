/**
 * Zaim Web版の家計簿明細一覧をAIDEの読み取りAPIから受け取る（Issue #383）。
 *
 * Zaim公開API `GET /v2/home/money` は**自動連携（スマートレシート・Amazon・銀行・カード）が
 * 作った明細をそもそも返さない**（#379で実測。`docs/receipt-import.md`）。読むにはZaimに
 * ログインしたブラウザでWeb版の画面を開くしかなく、Playwrightとログイン状態（storage state）は
 * AIDEだけが持っている。そこでAIDEが巡回した結果を `GET /api/money/transactions` から読む
 * （AIDE側: guchi-apps/aide#244）。
 *
 * **ここが返すのは「AIDEが最後に巡回したときの当月ぶん」**。以下は仕様であって不具合ではない。
 *
 * - **当月ぶんしか無い。** AIDEの巡回ジョブ（`zaim-money-sync`）が当月だけを読む。
 *   遡る日数が月をまたぐルールでも、先月ぶんの連携明細は入ってこない
 * - **巡回は1日2回。** 押した瞬間の明細ではないので、`fetchedAt` / `stale` を画面へ出す
 * - **品目名が省略されることがある。** 1件の明細に複数品目があると、一覧には先頭の1件しか
 *   出ず末尾が「…」になる（Zaim Web版の一覧表示自体の仕様）
 *
 * 残高・保有銘柄（`lib/zaim-aide.ts`）とは情報源も粒度も別物なので、AIDE側と同じく分けている。
 */

import { requestAideJson, ZaimAideError } from "./zaim-aide"

/** Zaim Web版の一覧から読んだ明細1件。カテゴリ・内訳・口座は**名前**で来る。 */
export interface ZaimAideMoneyEntry {
    /** Zaimの明細id。編集リンクから取れなかった行は null。 */
    id: number | null
    /** YYYY-MM-DD（JST）。 */
    date: string
    amount: number
    /** カテゴリ名（例: `食費`）。マスタのidは付いてこない。 */
    category: string
    /** 内訳名（例: `食料品`）。 */
    genre: string
    /** 出金元の口座名。 */
    account: string
    /** 振替の場合の振込先口座名。支出なら空。 */
    toAccount: string
    place: string
    /** 品目名。複数品目の明細では先頭の1件だけで、末尾が「…」で省略されることがある。 */
    name: string
    comment: string
}

/** `GET /api/money/transactions` の応答。鮮度の判断は呼び出し側に委ねられている。 */
export interface ZaimAideMoneyList {
    entries: ZaimAideMoneyEntry[]
    /** AIDEが巡回した時刻（ISO8601）。まだ一度も巡回していなければ null。 */
    fetchedAt: string | null
    ageMinutes: number | null
    /** AIDE側の鮮度判定。巡回間隔（1日2回）を超えていれば true。 */
    stale: boolean
    /** まだ一度も巡回していない。状態であってエラーではない。 */
    empty: boolean
}

function toText(value: unknown): string {
    return typeof value === "string" ? value.trim() : ""
}

function toNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null
}

/** 明細id。編集リンクから取れなかった行は AIDE 側で null になる。 */
function toMoneyId(value: unknown): number | null {
    const parsed = toNumber(value)
    return parsed !== null && Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

/**
 * `GET /api/money/transactions` の応答を畳む。**純粋関数。**
 *
 * 日付・金額が読めない行は落とす（対応付けようがないため）。1行の欠けで取得全体を
 * 失敗させない方針は `parseMoneySummary` と揃えている。
 */
export function parseMoneyTransactions(payload: unknown): ZaimAideMoneyList {
    const body = payload as Record<string, unknown>
    if (!body || typeof body !== "object") {
        throw new ZaimAideError("unreachable", "AIDEの応答を解釈できませんでした")
    }

    const rawEntries = Array.isArray(body.entries) ? body.entries : []
    const entries: ZaimAideMoneyEntry[] = rawEntries.flatMap((item) => {
        const record = item as Record<string, unknown>
        const date = toText(record?.date)
        const amount = toNumber(record?.amount)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || amount === null) return []

        return [
            {
                id: toMoneyId(record?.id),
                date,
                amount,
                category: toText(record?.category),
                genre: toText(record?.genre),
                account: toText(record?.account),
                toAccount: toText(record?.toAccount),
                place: toText(record?.place),
                name: toText(record?.name),
                comment: toText(record?.comment),
            },
        ]
    })

    return {
        entries,
        fetchedAt: toText(body.fetchedAt) || null,
        ageMinutes: toNumber(body.ageMinutes),
        stale: body.stale === true,
        empty: body.empty === true,
    }
}

/**
 * AIDEから当月ぶんのZaim家計簿明細を取得する。**キャッシュを読むだけで、Zaimへは取りに行かない。**
 *
 * キャッシュが空でもエラーにしない（`empty: true` で返る）。設定漏れ・接続不可は
 * `ZaimAideError` を投げるので、呼び出し側は「Zaim APIぶんだけで続ける」判断ができる。
 */
export async function fetchZaimMoneyListFromAide(): Promise<ZaimAideMoneyList> {
    const payload = await requestAideJson("/api/money/transactions")
    try {
        return parseMoneyTransactions(payload)
    } catch (cause) {
        if (cause instanceof ZaimAideError) throw cause
        throw new ZaimAideError("unreachable", "AIDEの応答を解釈できませんでした")
    }
}
