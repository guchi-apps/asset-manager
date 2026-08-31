/**
 * Zaim「レシート置き換え」の成立条件を実測で確かめるための組み立て（Issue #300）。
 *
 * 置き換えの最後の1手（アプリの「置き換え」ボタン）は**スマートフォンアプリ限定**で、
 * APIからもWeb版からも踏めない。そのため機械にできるのは「候補として出るはずの明細を
 * 条件違いで用意する」ところまでで、候補に出たかどうかの判定は人が実機で行う。
 * ここはその「条件違いの明細」を決める部分だけを持つ（実際の登録は
 * `scripts/zaim-replace-probe.ts`）。
 *
 * 確かめる条件は3つ。公式情報（https://content.zaim.net/questions/show/956）が挙げるのは
 * 「品目がある」「出金元が自動連携したクレジットカード・電子マネー」「日付・金額が一致」で、
 * **作成経路（API / Web版 / アプリ）を条件とする記述は見当たらない**。したがって
 * 現行実装（品目あり・出金元は「反映待ち」口座）が候補に出ないとすれば、疑うべきは
 * 作成経路よりも先に出金元になる。
 *
 * | | 内容 | これが通れば |
 * | --- | --- | --- |
 * | A | 反映待ち口座＋品目ありのAPI明細（現行実装と同じ） | 現行のまま運用できる |
 * | B | 連携カード口座＋品目ありのAPI明細 | 出金元を変えるだけで済む |
 * | C | 既存の連携カード明細をAPIで更新できるか | 置き換え自体が不要になる |
 *
 * AとBはこのファイルが組み立てる。Cは既存明細への no-op な更新なので選定だけを持つ。
 */

/** 検証用に作った明細だと後から機械的に見分けるための印。後片付けの拠り所でもある。 */
export const PROBE_COMMENT_MARKER = "Asset Manager 置き換え検証 #300"

export type ProbeCaseId = "A" | "B"

/** `GET /v2/home/money` の応答のうち、選定と組み立てに要る項目だけ。 */
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
 * 検証の的にする連携カード明細を1件選ぶ。
 *
 * 選定を人任せにすると「候補に出なかった」の原因が条件なのか的の選び方なのか分からなくなるため、
 * 次をすべて満たすものだけを採る。
 *
 * - **品目もコメントも空**。品目が入っている明細は人が手で書き足したか、すでに置き換え済みの
 *   可能性がある。素の連携明細でないと「置き換え前」の状態を再現できない
 * - **金額が正**。返金・値引き行（負値）は置き換えの対象として素直でない
 * - **集計対象内**（`active` が 1）
 * - **同じ日付・同じ金額の明細が他に無い**。日付と金額が一致するものが複数あると、
 *   候補に出た明細がどのケース由来か判別できない
 *
 * 置き換えは「新着の連携履歴」から辿る導線なので、条件を満たすうちで**最も新しい**ものを返す。
 */
export function pickProbeTarget(
    entries: ProbeMoneyEntry[],
    cardAccountId: number
): ProbeMoneyEntry | null {
    const sameDateAmountCount = new Map<string, number>()
    for (const entry of entries) {
        const key = `${entry.date}:${entry.amount}`
        sameDateAmountCount.set(key, (sameDateAmountCount.get(key) ?? 0) + 1)
    }

    const candidates = entries.filter(
        (entry) =>
            entry.fromAccountId === cardAccountId &&
            entry.active === 1 &&
            entry.amount > 0 &&
            entry.name === "" &&
            entry.comment === "" &&
            sameDateAmountCount.get(`${entry.date}:${entry.amount}`) === 1
    )
    if (candidates.length === 0) return null

    // 日付が同じなら id の大きい（後から入った）ほうを新しいものとして扱う。
    return candidates.reduce((newest, entry) =>
        entry.date > newest.date || (entry.date === newest.date && entry.id > newest.id)
            ? entry
            : newest
    )
}

export interface ProbeAccounts {
    /** 「反映待ち」口座（`ZAIM_PENDING_ACCOUNT_ID`）。ケースAの出金元。 */
    pendingAccountId: number
    /** 自動連携しているクレジットカードの口座。ケースBの出金元で、的を選ぶ口座でもある。 */
    cardAccountId: number
}

/**
 * 的にした連携カード明細に対して、条件だけを変えた検証明細を組み立てる。
 *
 * **日付・金額は的と完全に一致させる。** 公式が挙げる置き換えの条件がそこなので、
 * ここを変えると何を確かめているのか分からなくなる。カテゴリ・内訳も的から引き継ぐ
 * （Zaimの支出登録がカテゴリ・内訳を必須にするため、勝手な値を入れると分類が汚れる）。
 */
export function buildProbeCases(target: ProbeMoneyEntry, accounts: ProbeAccounts): ProbeCase[] {
    const base = {
        date: target.date,
        amount: target.amount,
        categoryId: target.categoryId,
        genreId: target.genreId,
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

/**
 * ケースC（連携明細をAPIで更新できるか）の的を選ぶ。
 *
 * 送るのは**取得した値と同じ値**なので、成功しても明細は1文字も変わらない。可否だけが分かる。
 * 内訳が決まっていない明細（`genreId` が 0）は更新APIが受け付けないため除く——
 * 弾かれたのが「連携明細だから」なのか「内訳が空だから」なのか判別できなくなる。
 */
export function pickEditProbeTarget(
    entries: ProbeMoneyEntry[],
    cardAccountId: number
): ProbeMoneyEntry | null {
    const candidates = entries.filter(
        (entry) =>
            entry.fromAccountId === cardAccountId &&
            entry.active === 1 &&
            entry.genreId > 0 &&
            entry.categoryId > 0 &&
            !isProbeEntry(entry)
    )
    if (candidates.length === 0) return null

    return candidates.reduce((newest, entry) =>
        entry.date > newest.date || (entry.date === newest.date && entry.id > newest.id)
            ? entry
            : newest
    )
}
