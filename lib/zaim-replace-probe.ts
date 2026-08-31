/**
 * Zaim「レシート置き換え」の成立条件を実測で確かめるための組み立て（Issue #300）。
 *
 * ## 機械だけでは結論が出ない
 *
 * 置き換えの最後の1手（アプリの「置き換え」ボタン）は**スマートフォンアプリ限定**で、
 * APIにもWeb版にも無い。さらに後述のとおり、**置き換える相手であるカード連携明細そのものが
 * 公開APIから見えない**。したがってコマンドにできるのは「候補として出るはずの明細を条件違いで
 * 用意する」ところまでで、的の指定も結果の確認も人が画面を見て行う。
 *
 * ## 素の連携明細は公開APIから見えない
 *
 * `GET /v2/home/money` が返すのは**利用者が手入力した明細と、置き換え済みの明細だけ**。
 * まだ置き換えていないカード連携明細は返らない（#300 で実測。アプリに見えている
 * 「2026-08-27 / 550円 / 東テスティバル」が、同期間の支出414件のどこにも無かった）。
 *
 * このため**的をAPIから探すことはできない**。日付・金額は人が画面で読んだ値を渡してもらう
 * （`--date` / `--amount`）。初回の検証では的をAPIから自動で選ぼうとして2度空振りした——
 * 見えていたのは置き換え済みのレシート商品行で、素の連携明細ではなかった。
 *
 * ## 確かめる条件
 *
 * 公式情報（https://content.zaim.net/questions/show/956）が挙げるのは「品目がある」
 * 「出金元が自動連携したクレジットカード・電子マネー」「日付・金額が一致」で、
 * **作成経路（API / Web版 / アプリ）を条件とする記述は見当たらない**。したがって
 * 現行実装（品目あり・出金元は「反映待ち」口座）が候補に出ないとすれば、疑うべきは
 * 作成経路よりも先に出金元になる。
 *
 * | | 内容 | これが通れば |
 * | --- | --- | --- |
 * | A | 反映待ち口座＋品目ありのAPI明細（現行実装と同じ） | 現行のまま運用できる |
 * | B | 連携カード口座＋品目ありのAPI明細 | 出金元を変えるだけで済む |
 *
 * どちらも候補に出ないなら、API登録では置き換えに載せられないと結論できる。
 */

/** 検証用に作った明細だと後から機械的に見分けるための印。後片付けの拠り所でもある。 */
export const PROBE_COMMENT_MARKER = "Asset Manager 置き換え検証 #300"

export type ProbeCaseId = "A" | "B"

/** `GET /v2/home/money` の応答のうち、衝突の検知と既定値の決定に要る項目だけ。 */
export interface ProbeMoneyEntry {
    id: number
    date: string
    amount: number
    fromAccountId: number
    categoryId: number
    genreId: number
    name: string
    place: string
    comment: string
    active: number
}

/**
 * 検証の的にするカード連携明細。**APIから引けないので、人が画面で読んだ値をそのまま持つ。**
 */
export interface ProbeTarget {
    /** YYYY-MM-DD（JST）。 */
    date: string
    amount: number
    /** 店舗名。空でもよい（登録時に代替の文字列を入れる）。 */
    place: string
}

/** 支出登録に必須のカテゴリ・内訳。 */
export interface ProbeGenre {
    categoryId: number
    genreId: number
}

/** 登録する検証明細1件。`scripts/zaim-replace-probe.ts` がそのままZaimへ送る。 */
export interface ProbeCase {
    caseId: ProbeCaseId
    /** 何を確かめる条件かの1行説明。画面とIssueへそのまま出す。 */
    hypothesis: string
    date: string
    amount: number
    fromAccountId: number
    categoryId: number
    genreId: number
    name: string
    place: string
    comment: string
}

export function buildProbeComment(caseId: ProbeCaseId): string {
    return `${PROBE_COMMENT_MARKER} [${caseId}]`
}

/** 検証用に作った明細か。`--cleanup` はこれが真の明細だけを消す。 */
export function isProbeEntry(entry: Pick<ProbeMoneyEntry, "comment">): boolean {
    return entry.comment.includes(PROBE_COMMENT_MARKER)
}

export function collectProbeEntries(entries: ProbeMoneyEntry[]): ProbeMoneyEntry[] {
    return entries.filter(isProbeEntry)
}

/**
 * 人が渡した的の値を検証する。
 *
 * **黙って補正しない。** 日付や金額がずれたまま登録すると、置き換えの条件（日付・金額の一致）を
 * 満たさないまま「候補に出ませんでした」という結果だけが残る。
 */
export function parseProbeTarget(input: {
    date?: string | undefined
    amount?: string | number | undefined
    place?: string | undefined
}): ProbeTarget {
    const date = (input.date ?? "").trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error("--date には置き換え前のカード明細の日付を YYYY-MM-DD で指定してください。")
    }

    const amount = Number(input.amount)
    if (!Number.isInteger(amount) || amount <= 0) {
        throw new Error("--amount には置き換え前のカード明細の金額を正の整数で指定してください。")
    }

    return { date, amount, place: (input.place ?? "").trim() }
}

/**
 * 的と同じ日付・金額の明細がすでにAPIから見えていないかを調べる。
 *
 * 見えているなら、それは**手入力済みか置き換え済みの明細**なので、その日付・金額での検証は
 * 候補が入り混じって成立しない。検証用に作った明細は対象外（`--cleanup` の守備範囲）。
 */
export function findConflictingEntries(
    entries: ProbeMoneyEntry[],
    target: ProbeTarget
): ProbeMoneyEntry[] {
    return entries.filter(
        (entry) =>
            entry.date === target.date &&
            entry.amount === target.amount &&
            entry.active === 1 &&
            !isProbeEntry(entry)
    )
}

/**
 * 検証明細に使うカテゴリ・内訳の既定値を決める。
 *
 * Zaimの支出登録はカテゴリ・内訳を必須にするが、置き換えの条件には入っていない。
 * 何を入れても検証の結論は変わらないので、**家計簿でいちばん使われている組**を借りる。
 * 使ったことのないカテゴリを勝手に作らないためで、`--category` / `--genre` で上書きできる。
 */
export function resolveDefaultGenre(entries: ProbeMoneyEntry[]): ProbeGenre | null {
    const counts = new Map<string, { genre: ProbeGenre; count: number }>()
    for (const entry of entries) {
        if (entry.categoryId <= 0 || entry.genreId <= 0) continue
        const key = `${entry.categoryId}:${entry.genreId}`
        const found = counts.get(key)
        if (found) {
            found.count += 1
            continue
        }
        counts.set(key, {
            genre: { categoryId: entry.categoryId, genreId: entry.genreId },
            count: 1,
        })
    }

    let best: { genre: ProbeGenre; count: number } | null = null
    for (const candidate of counts.values()) {
        // 同数のときは内訳idの小さいほうを採り、実行のたびに結果が変わらないようにする。
        if (
            !best ||
            candidate.count > best.count ||
            (candidate.count === best.count && candidate.genre.genreId < best.genre.genreId)
        ) {
            best = candidate
        }
    }
    return best?.genre ?? null
}

export interface ProbeAccounts {
    /** 「反映待ち」口座（`ZAIM_PENDING_ACCOUNT_ID`）。ケースAの出金元。 */
    pendingAccountId: number
    /** 自動連携しているクレジットカードの口座。ケースBの出金元。 */
    cardAccountId: number
}

/**
 * 的にしたカード明細に対して、出金元だけを変えた検証明細を組み立てる。
 *
 * **日付・金額は的と完全に一致させる。** 公式が挙げる置き換えの条件がそこなので、
 * ここを変えると何を確かめているのか分からなくなる。
 */
export function buildProbeCases(
    target: ProbeTarget,
    accounts: ProbeAccounts,
    genre: ProbeGenre
): ProbeCase[] {
    const base = {
        date: target.date,
        amount: target.amount,
        categoryId: genre.categoryId,
        genreId: genre.genreId,
        place: target.place || "置き換え検証",
    }

    return [
        {
            ...base,
            caseId: "A",
            hypothesis: "反映待ち口座＋品目ありのAPI明細（現行実装と同じ条件）",
            fromAccountId: accounts.pendingAccountId,
            name: "置き換え検証A 反映待ち",
            comment: buildProbeComment("A"),
        },
        {
            ...base,
            caseId: "B",
            hypothesis: "連携カード口座＋品目ありのAPI明細（出金元だけをAから変えたもの）",
            fromAccountId: accounts.cardAccountId,
            name: "置き換え検証B 連携カード",
            comment: buildProbeComment("B"),
        },
    ]
}
