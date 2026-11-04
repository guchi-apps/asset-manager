/**
 * 取り込み元の口座名・カテゴリ名と、家計簿の口座・カテゴリの対応（Issue #816）。DBに触らない純粋な関数。
 *
 * 取り込み元に固有の名前の扱いはここと `lib/ledger-sources/<provider>/` に閉じ込め、家計簿の本体
 * （`lib/ledger-*.ts`）は対応表の結果（口座id・カテゴリid）だけを見る。
 */
import type { LedgerAccountKindValue } from "@/lib/ledger-input"

export const ZAIM_PROVIDER = "zaim"

export type AccountMappingTarget = "ACCOUNT" | "INFO_SOURCE"

/** Zaimは空欄を「-」で表す。空・「-」は名前が無いものとして null にする */
export function normalizeExternalName(value: unknown): string | null {
    if (typeof value !== "string") return null
    const trimmed = value.trim()
    if (!trimmed || trimmed === "-") return null
    return trimmed.slice(0, 191)
}

export interface AccountGuess {
    target: AccountMappingTarget
    kind: LedgerAccountKindValue
    hasStatementFeed: boolean
}

/**
 * 口座名から、口座の種類と「明細が自動で届くか」を推定する。対応表をまとめて作るときの初期値で、
 * 人が設定画面で直せる。スマートレシート・Amazon・楽天市場のような連携サービスは、支払いがカード側に
 * 出るので取引にしない「情報源」とする（#814）。
 */
export function guessAccount(name: string): AccountGuess {
    const n = name.normalize("NFKC")
    // 「反映待ち」は旧運用（Zaimへの登録・置き換え）でレシートを入れていた口座。支払いはカード明細の側にあるので取引にしない
    if (/スマートレシート|amazon|楽天市場|yahoo!?ショッピング|反映待ち/i.test(n)) {
        return { target: "INFO_SOURCE", kind: "OTHER", hasStatementFeed: true }
    }
    if (/証券|nisa|ideco|確定拠出/i.test(n)) return { target: "ACCOUNT", kind: "SECURITIES", hasStatementFeed: true }
    if (/icoca|suica|pasmo|manaca|toica|sugoca|nimoca|kitaca/i.test(n)) {
        return { target: "ACCOUNT", kind: "EMONEY", hasStatementFeed: true }
    }
    if (/paypay|nanaco|waon|edy|商品券|プリペイド|ギフト/i.test(n)) {
        return { target: "ACCOUNT", kind: "EMONEY", hasStatementFeed: false }
    }
    if (/ポイント|マイル/.test(n)) return { target: "ACCOUNT", kind: "POINT", hasStatementFeed: false }
    if (/財布|現金|お財布/.test(n)) return { target: "ACCOUNT", kind: "CASH", hasStatementFeed: false }
    if (/カード|card|visa|jcb|master|amex|diners/i.test(n)) return { target: "ACCOUNT", kind: "CARD", hasStatementFeed: true }
    if (/銀行|信金|信用金庫|口座|bank|普通|定期/i.test(n)) return { target: "ACCOUNT", kind: "BANK", hasStatementFeed: true }
    return { target: "ACCOUNT", kind: "OTHER", hasStatementFeed: false }
}

export interface CategoryMappingRow {
    externalCategory: string
    /** 内訳を問わない対応は空文字 */
    externalGenre: string
    categoryId: number
}

/** 内訳まで一致する対応を優先し、無ければカテゴリだけの対応を使う。どちらも無ければ null */
export function resolveCategoryMapping(
    mappings: readonly CategoryMappingRow[],
    category: string | null,
    genre: string | null
): number | null {
    if (!category) return null
    const exact = genre ? mappings.find((m) => m.externalCategory === category && m.externalGenre === genre) : undefined
    if (exact) return exact.categoryId
    return mappings.find((m) => m.externalCategory === category && m.externalGenre === "")?.categoryId ?? null
}

/** 画面に出す取り込み元の分類名（「食費 / 飲料」） */
export function sourceCategoryLabel(category: string | null, genre: string | null): string {
    if (!category) return "（分類なし）"
    return genre ? `${category} / ${genre}` : category
}
