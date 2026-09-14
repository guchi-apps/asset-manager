/**
 * Zaim Web版の明細（AIDE経由）を、Zaim APIの明細と同じ形へ寄せる（Issue #383）。
 *
 * Web版の一覧が返すのは**表示のままの名前**（口座名・カテゴリ名・内訳名）で、Zaim APIが返す
 * `from_account_id` / `category_id` / `genre_id` は付いてこない。一方で口座間コピー
 * （`lib/zaim-copy.ts`）も連携明細の取り込み（`lib/zaim-linked-import.ts`）も、判定はすべて
 * **idの一致**で行っている。そこで取り込み済みのマスタ（`ZaimAccount` / `ZaimGenre`）と
 * 名前で突き合わせ、idの付いた明細へ変換する。
 *
 * **二重登録の防止はZaim明細idが取れることが前提**（`ZaimCopiedEntry`・コメントの印・
 * `ReceiptItem.sourceZaimMoneyId` のいずれもidで照合する）。idを取れなかった行は、
 * 複製すると次回も候補に出て無限に増えるため**必ず落とす**。
 *
 * ここはDBもAIDEも触らない純粋な変換だけを持つ。
 */

import type { ReceiptGenreOption } from "@/lib/receipt-analysis"
import type { ZaimAideMoneyEntry } from "@/lib/zaim-aide-money"
import type { CopyableMoneyEntry } from "@/lib/zaim-copy"
import type { ZaimAccountRef } from "@/lib/zaim-linked-source"

/**
 * 名前の突き合わせ用に整える。
 *
 * Zaimの画面表示とマスタの値で全角・半角や空白の入り方が違うことがあるため、NFKCへ寄せて
 * 空白を落とす。ここで落としすぎると別々の口座が同じキーになるので、大文字小文字は保つ。
 */
export function normalizeMasterName(name: string): string {
    return name.normalize("NFKC").replace(/\s+/g, "")
}

/**
 * 口座名の末尾の括弧書きを1つ外す（Issue #419）。`normalizeMasterName` を通した名前を渡す。
 *
 * Web版の一覧は口座名を画像の `alt` から読むため、「スマートレシート (自動連携)」のように
 * マスタの口座名へ表記が足されていると完全一致では引けない。NFKCで全角の括弧は半角へ寄るので、
 * ここでは半角だけを見ればよい。外すのはWeb版の名前の側だけ（`resolveAccountId`）。
 * **実際の表記はまだ確かめられていない**（docs参照）。
 */
export function stripTrailingParenthetical(normalizedName: string): string {
    return normalizedName.replace(/\([^()]*\)$/, "")
}

/** 名前 → id の索引。同じ名前が複数あるものは、どれか決められないので引けなくする。 */
function buildUniqueIndex<T>(rows: T[], key: (row: T) => string): Map<string, T> {
    const index = new Map<string, T>()
    const duplicated = new Set<string>()

    for (const row of rows) {
        const name = normalizeMasterName(key(row))
        if (!name) continue
        if (index.has(name)) {
            duplicated.add(name)
            continue
        }
        index.set(name, row)
    }

    for (const name of duplicated) index.delete(name)
    return index
}

/** カテゴリ名・内訳名の組を1つのキーにする。内訳名は複数のカテゴリに同名で存在しうる。 */
function genreKey(categoryName: string, genreName: string): string {
    return normalizeMasterName(categoryName) + " " + normalizeMasterName(genreName)
}

export interface ZaimMasterIndex {
    /** 口座名 → Zaim口座id。 */
    accountIdByName: Map<string, number>
    /**
     * 括弧書きを外したWeb版の口座名で引き直すときの索引（#419）。`accountIdByName` で引けなかったときだけ使う。
     *
     * **無効な口座も含めて**同名を判定し、有効な口座だけを残す。有効な口座だけで判定すると、
     * 無効化した口座「X(旧)」と有効な口座「X」が並ぶとき、同名の無効口座「X」を見落として寄せてしまう。
     */
    accountIdForStrippedName: Map<string, number>
    /**
     * 無効な口座も含めた全口座の名前。Web版の名前がそのまま実在する（＝無効化した口座の明細）なら、
     * 括弧を外して別の口座へ寄せない。
     */
    knownAccountNames: Set<string>
    /** `カテゴリ名 + 内訳名` → 内訳。 */
    genreByFullName: Map<string, ReceiptGenreOption>
    /** 内訳名だけ → 内訳。同名の内訳が複数カテゴリにある場合は引けない。 */
    genreByGenreName: Map<string, ReceiptGenreOption>
}

/** 取り込み済みのマスタから、名前で引ける索引を作る。 */
export function buildZaimMasterIndex(
    accounts: ZaimAccountRef[],
    genres: ReceiptGenreOption[],
    /** 無効化した口座。括弧書きを外して引き直すときの衝突判定にだけ使う（#419）。 */
    inactiveAccounts: ZaimAccountRef[] = []
): ZaimMasterIndex {
    const accountByName = buildUniqueIndex(accounts, (account) => account.name)
    const allAccounts = [
        ...accounts.map((account) => ({ ...account, active: true })),
        ...inactiveAccounts.map((account) => ({ ...account, active: false })),
    ]
    // 有効な口座と無効な口座が同名なら、buildUniqueIndex がどちらか決められないとして引けなくする。
    const accountByAnyName = buildUniqueIndex(allAccounts, (account) => account.name)

    const genreByFullName = new Map<string, ReceiptGenreOption>()
    for (const genre of genres) {
        const key = genreKey(genre.categoryName, genre.genreName)
        // 同じカテゴリに同名の内訳は無い前提だが、あった場合は先勝ちで十分（idはどちらでも通る）。
        if (!genreByFullName.has(key)) genreByFullName.set(key, genre)
    }

    return {
        accountIdByName: new Map(
            [...accountByName].map(([name, account]) => [name, account.zaimAccountId])
        ),
        accountIdForStrippedName: new Map(
            [...accountByAnyName]
                .filter(([, account]) => account.active)
                .map(([name, account]) => [name, account.zaimAccountId])
        ),
        knownAccountNames: new Set(
            allAccounts.map((account) => normalizeMasterName(account.name)).filter(Boolean)
        ),
        genreByFullName,
        genreByGenreName: buildUniqueIndex(genres, (genre) => genre.genreName),
    }
}

/**
 * Web版の明細を合流させた結果の内訳（Issue #383）。
 *
 * 「候補が0件なのはなぜか」を画面から追えるようにするために、落とした理由まで数える。
 * #321・#379 と同じ考え方で、**0件だったことだけを伝えても原因に辿り着けない**。
 */
export interface WebMoneyMergeBreakdown {
    /** AIDEから読めた明細の総数。 */
    scanned: number
    /** Zaim APIの明細に合流させた件数。 */
    merged: number
    /** Zaim APIからも読めたため落とした件数（同じ明細を二度数えない）。 */
    duplicate: number
    /** 明細idが取れず落とした件数。**二重登録を防げないため複製の対象にできない。** */
    noId: number
    /** 支出ではない（振替・収入）ため落とした件数。 */
    notPayment: number
    /** 口座名をマスタと突き合わせられず落とした件数。 */
    unknownAccount: number
    /**
     * 突き合わせられなかった口座名（Web版の表記のまま・重複なし）。
     * 件数だけでは表記の揺れなのか本当に無い口座なのかを見分けられないため、画面に出す（#419）。
     */
    unknownAccountNames: string[]
    /** 合流はしたが内訳名をマスタと突き合わせられなかった件数（「内訳が未設定」として出る）。 */
    unknownGenre: number
}

export interface WebMoneyMergeResult {
    entries: CopyableMoneyEntry[]
    breakdown: WebMoneyMergeBreakdown
}

/**
 * Web版の口座名をZaim口座idへ引く。引けなければ undefined。
 *
 * 完全一致を必ず先に試し、引けなかったときだけ**Web版の名前の側**から末尾の括弧書きを外して
 * 引き直す（#419）。マスタの口座名は加工しない。次の場合は引き直さない。
 *
 * - Web版の名前が無効な口座・同名の口座として実在する（その口座の明細なので、別の口座へ寄せない）
 * - 括弧を外した名前が、有効な口座と無効な口座のどちらにもある（どちらか決められない）
 */
function resolveAccountId(webAccount: string, master: ZaimMasterIndex): number | undefined {
    const name = normalizeMasterName(webAccount)
    const exact = master.accountIdByName.get(name)
    if (exact !== undefined) return exact
    if (master.knownAccountNames.has(name)) return undefined

    const stripped = stripTrailingParenthetical(name)
    if (!stripped || stripped === name) return undefined
    return master.accountIdForStrippedName.get(stripped)
}

/**
 * Web版の明細を `CopyableMoneyEntry` へ変換する。
 *
 * `knownMoneyIds` にはZaim APIから読めた明細idを渡す。Web版の一覧は**APIで読める明細も
 * まとめて表示する**ため、渡さないと同じ明細が二重に候補へ並ぶ。
 *
 * `active` は必ず `true` にする。Web版の一覧からは集計対象外かどうかを読めないため
 * （AIDEが返す項目に無い）。集計対象外の明細を1度だけ複製してしまう余地は残るが、
 * `ZaimCopiedEntry` があるので繰り返しはしない。
 */
export function mergeWebMoneyEntries(
    webEntries: ZaimAideMoneyEntry[],
    master: ZaimMasterIndex,
    options: { knownMoneyIds: ReadonlySet<number> }
): WebMoneyMergeResult {
    const breakdown: WebMoneyMergeBreakdown = {
        scanned: webEntries.length,
        merged: 0,
        duplicate: 0,
        noId: 0,
        notPayment: 0,
        unknownAccount: 0,
        unknownAccountNames: [],
        unknownGenre: 0,
    }

    const entries: CopyableMoneyEntry[] = []
    const seen = new Set<number>()

    for (const web of webEntries) {
        if (web.id === null) {
            breakdown.noId += 1
            continue
        }
        if (options.knownMoneyIds.has(web.id) || seen.has(web.id)) {
            breakdown.duplicate += 1
            continue
        }
        // 振替は出金元と振込先の両方が埋まる。支出だけを複製・取り込みの対象にする。
        if (!web.account || web.toAccount) {
            breakdown.notPayment += 1
            continue
        }

        const fromAccountId = resolveAccountId(web.account, master)
        if (fromAccountId === undefined) {
            breakdown.unknownAccount += 1
            if (!breakdown.unknownAccountNames.includes(web.account)) {
                breakdown.unknownAccountNames.push(web.account)
            }
            continue
        }

        const genre =
            master.genreByFullName.get(genreKey(web.category, web.genre)) ??
            master.genreByGenreName.get(normalizeMasterName(web.genre))
        if (!genre) breakdown.unknownGenre += 1

        seen.add(web.id)
        breakdown.merged += 1
        entries.push({
            id: web.id,
            date: web.date,
            amount: web.amount,
            name: web.name || null,
            place: web.place || null,
            fromAccountId,
            categoryId: genre?.zaimCategoryId ?? null,
            genreId: genre?.zaimGenreId ?? null,
            comment: web.comment || null,
            active: true,
        })
    }

    return { entries, breakdown }
}
