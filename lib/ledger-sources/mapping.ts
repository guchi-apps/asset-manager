/**
 * 取り込み元の口座名・カテゴリ名と、家計簿の口座・カテゴリの対応（Issue #816）。DBに触らない純粋な関数。
 *
 * 取り込み元に固有の名前の扱いはここと `lib/ledger-sources/<provider>/` に閉じ込め、家計簿の本体
 * （`lib/ledger-*.ts`）は対応表の結果（口座id・カテゴリid）だけを見る。
 */
import type { LedgerAccountKindValue } from "@/lib/ledger-input"

export const ZAIM_PROVIDER = "zaim"

/** 「Zaimで非表示」の口座名か。取り込み元がZaimのときだけ、無効にした口座名の集合と照らす（#927） */
export function isZaimHiddenName(provider: string, name: string, hiddenNames: ReadonlySet<string>): boolean {
    return provider === ZAIM_PROVIDER && hiddenNames.has(name)
}

/** YYYY-MM-DD の最新日を選ぶ。どちらかが無ければもう一方 */
export function laterDate(a: string | null, b: string | null): string | null {
    if (a === null) return b
    if (b === null) return a
    return a >= b ? a : b
}

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

/** 口座名の対応1行と、対応先の家計簿の口座の種類（`LedgerSourceAccountMapping` + `LedgerAccount.kind`）。 */
export interface ExternalAccountMappingRow {
    externalName: string
    target: string
    /** target が ACCOUNT のときの対応先の口座の種類。口座が見つからなければ null */
    accountKind: LedgerAccountKindValue | null
}

export interface ExternalAccountClass {
    target: AccountMappingTarget
    /** 家計簿での口座の種類。情報源・対応先の口座が無いときは null */
    kind: LedgerAccountKindValue | null
    /** 口座名の対応から決めたか（false なら `guessAccount` の推定） */
    mapped: boolean
}

/** 口座名の比較用キー。Web版の「(自動連携)」のような末尾の括弧書きと全角・空白の揺れを吸収する */
export function looseAccountKey(name: string): string {
    return name.normalize("NFKC").replace(/\s+/g, "").replace(/\([^()]*\)$/, "")
}

/**
 * 取り込み元（Zaim）の口座名が、家計簿でどの扱いの口座かを引く関数を作る（Issue #843）。
 *
 * 以前はZaim APIの口座マスタ（`ZaimAccount.kind`）で「カードの口座か」などを見ていた。マスタは更新されなく
 * なったので、家計簿の口座名の対応（人が設定画面で直せる）を正にする。対応が無い名前は `guessAccount` で推定する。
 * 名前は原文のまま一致するものを優先し、無ければ括弧書き・空白の揺れを除いて一意に引けるものを使う。
 */
export function buildExternalAccountClassifier(
    rows: readonly ExternalAccountMappingRow[]
): (name: string) => ExternalAccountClass {
    const exact = new Map<string, ExternalAccountMappingRow>()
    const loose = new Map<string, ExternalAccountMappingRow | null>()
    for (const row of rows) {
        const name = row.externalName.trim()
        exact.set(name, row)
        const key = looseAccountKey(name)
        // 揺れを除くと同じになる名前が複数あれば、どちらか決められないので引かない
        loose.set(key, loose.has(key) ? null : row)
    }
    return (raw) => {
        const name = raw.trim()
        const row = exact.get(name) ?? loose.get(looseAccountKey(name)) ?? null
        if (!row) {
            const guess = guessAccount(name)
            return { target: guess.target, kind: guess.target === "ACCOUNT" ? guess.kind : null, mapped: false }
        }
        if (row.target === "INFO_SOURCE") return { target: "INFO_SOURCE", kind: null, mapped: true }
        return { target: "ACCOUNT", kind: row.accountKind, mapped: true }
    }
}

/** カードの口座か。カード明細起点の対応付け（`getCardReconciliationOverview`）が、どの明細をカード明細とみなすかに使う */
export function isCardAccountClass(account: ExternalAccountClass): boolean {
    return account.target === "ACCOUNT" && account.kind === "CARD"
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
