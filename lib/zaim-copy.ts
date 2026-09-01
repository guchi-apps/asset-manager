/**
 * 口座間で明細を複製する判定（Issue #271）。
 *
 * スマートレシート・Amazonの明細を「反映待ち」口座へ写す作業を、口座の組み合わせを登録すれば
 * 済むようにする。複製そのものはZaimへの新規登録なので、**同じ元明細を二度登録しないこと**が
 * この機能の要になる。
 *
 * ここはDBもZaim APIも触らない純粋な判定だけを持つ。
 */

/** 複製の対象になりうる支出。`fetchZaimMoney` の結果から作る。 */
export interface CopyableMoneyEntry {
    id: number
    /** YYYY-MM-DD（JST）。 */
    date: string
    amount: number
    name: string | null
    place: string | null
    fromAccountId: number
    categoryId: number | null
    genreId: number | null
    comment: string | null
    /** Zaimで集計対象外にした明細は false。 */
    active: boolean
}

export interface CopyRule {
    id: number
    fromAccountId: number
    toAccountId: number
    lookbackDays: number
    enabled: boolean
    autoCopy: boolean
}

/**
 * 複製した明細のZaimコメントへ入れる印。
 *
 * 複製先の明細を人が見たときに出どころが分かるようにするのと、複製した明細を
 * 「複製元」として二重に拾わないための手がかりを兼ねる。
 */
export const COPY_COMMENT_PREFIX = "Asset Manager 複製 #"

export function buildCopyComment(sourceMoneyId: number): string {
    return COPY_COMMENT_PREFIX + sourceMoneyId
}

/** コメントの印から複製元のZaim明細idを読む。印が無ければ null。 */
export function parseCopyComment(comment: string | null | undefined): number | null {
    if (!comment) return null
    const index = comment.indexOf(COPY_COMMENT_PREFIX)
    if (index < 0) return null

    const rest = comment.slice(index + COPY_COMMENT_PREFIX.length)
    const matched = /^\d+/.exec(rest)
    if (!matched) return null

    const parsed = Number(matched[0])
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export interface CopyCandidateOptions {
    /** すでに複製済みの元明細id。`ZaimCopiedEntry` から作る。 */
    copiedSourceIds: ReadonlySet<number>
}

/**
 * 明細が候補から外れた理由（Issue #321）。候補になる場合は null。
 *
 * - `otherAccount` … コピー元口座以外の明細
 * - `inactive` … Zaimで集計対象外にした明細（置き換えを済ませた元明細を拾い直さない）
 * - `nonPositive` … 金額が0以下の明細（連携の調整用）
 * - `alreadyCopied` … すでに複製済みの明細
 * - `copyGenerated` … 自分が複製して作った明細（コメントの印で分かる）
 */
export type CopyExclusionReason =
    | "otherAccount"
    | "inactive"
    | "nonPositive"
    | "alreadyCopied"
    | "copyGenerated"

/**
 * 1件が候補から外れる理由を返す。候補になるなら null。
 *
 * **候補の判定はここが唯一の正**にしてある（`selectCopyTargets` もこれを通す）。
 * 画面に出す除外の内訳と実際に複製する明細が別々の条件で決まると、
 * 「0件と言われたが理由が合っていない」という追えない状態になる。
 */
export function findCopyExclusionReason(
    entry: CopyableMoneyEntry,
    rule: CopyRule,
    options: CopyCandidateOptions
): CopyExclusionReason | null {
    if (entry.fromAccountId !== rule.fromAccountId) return "otherAccount"
    if (!entry.active) return "inactive"
    if (!Number.isFinite(entry.amount) || entry.amount <= 0) return "nonPositive"
    if (options.copiedSourceIds.has(entry.id)) return "alreadyCopied"
    // 自分が複製した明細を、さらに複製元として拾わない（複製先が別ルールのコピー元でも起きうる）。
    if (parseCopyComment(entry.comment) !== null) return "copyGenerated"
    return null
}

/**
 * このルールで複製すべき明細を選ぶ。
 *
 * 外す条件は `findCopyExclusionReason` を参照。いずれも入れると家計簿に重複や無意味な行が残る。
 */
export function selectCopyTargets(
    entries: CopyableMoneyEntry[],
    rule: CopyRule,
    options: CopyCandidateOptions
): CopyableMoneyEntry[] {
    return entries.filter((entry) => findCopyExclusionReason(entry, rule, options) === null)
}

/**
 * 「なぜ候補が出ないのか」をプレビューで示すための内訳（Issue #321）。
 *
 * 候補が0件のとき、コピー元口座の指定が違うのか・全部複製済みなのかを画面から見分けられず、
 * Zaimの明細を直接引くまで原因が分からなかった（#321はコピー元口座に明細が1件も無い状態だった）。
 */
export interface CopyExclusionBreakdown {
    /** 期間内にZaimから読んだ明細の総数（口座を問わない）。 */
    scanned: number
    /** そのうちコピー元口座の明細。**ここが0ならコピー元の指定が実態と合っていない。** */
    fromAccount: number
    /** Zaimで集計対象外にした明細。 */
    inactive: number
    /** 金額が0以下の明細。 */
    nonPositive: number
    /** すでに複製済みの明細。 */
    alreadyCopied: number
    /** この機能が複製して作った明細。 */
    copyGenerated: number
}

/** 除外理由ごとの件数を数える。`selectCopyTargets` と同じ判定を通す。 */
export function summarizeCopyExclusions(
    entries: CopyableMoneyEntry[],
    rule: CopyRule,
    options: CopyCandidateOptions
): CopyExclusionBreakdown {
    const breakdown: CopyExclusionBreakdown = {
        scanned: entries.length,
        fromAccount: 0,
        inactive: 0,
        nonPositive: 0,
        alreadyCopied: 0,
        copyGenerated: 0,
    }

    for (const entry of entries) {
        const reason = findCopyExclusionReason(entry, rule, options)
        if (reason === "otherAccount") continue

        breakdown.fromAccount += 1
        if (reason !== null) breakdown[reason] += 1
    }

    return breakdown
}

export interface CopyPayload {
    sourceMoneyId: number
    date: string
    amount: number
    categoryId: number
    genreId: number
    fromAccountId: number
    name: string | null
    place: string | null
    comment: string
}

/**
 * 複製として登録する内容を組み立てる。
 *
 * Zaimの支出登録はカテゴリ・内訳を必須にするため、元明細の内訳が決まっていない場合は
 * 複製できない。その行は `skipped` として返し、内訳の提案で決めてから複製し直してもらう。
 */
export function buildCopyPayloads(
    entries: CopyableMoneyEntry[],
    rule: CopyRule
): { payloads: CopyPayload[]; skipped: CopyableMoneyEntry[] } {
    const payloads: CopyPayload[] = []
    const skipped: CopyableMoneyEntry[] = []

    for (const entry of entries) {
        if (!entry.categoryId || !entry.genreId) {
            skipped.push(entry)
            continue
        }

        payloads.push({
            sourceMoneyId: entry.id,
            date: entry.date,
            amount: Math.round(entry.amount),
            categoryId: entry.categoryId,
            genreId: entry.genreId,
            fromAccountId: rule.toAccountId,
            name: entry.name?.trim() || null,
            place: entry.place?.trim() || null,
            comment: buildCopyComment(entry.id),
        })
    }

    return { payloads, skipped }
}

/**
 * プレビューでチェックを外した明細を、複製する内容から取り除く（Issue #286）。
 *
 * 外す判断は画面でしか行えないので、ここは「渡されたidを落とす」だけに留める。
 * 落とした行を捨てずに返すのは、実行後の報告で「自分で外した件数」を
 * 内訳が未設定で複製できなかった件数と区別して出すため。
 */
export function excludeSkippedPayloads(
    payloads: CopyPayload[],
    skipSourceIds: ReadonlySet<number>
): { chosen: CopyPayload[]; skippedByUser: CopyPayload[] } {
    if (skipSourceIds.size === 0) return { chosen: payloads, skippedByUser: [] }

    const chosen: CopyPayload[] = []
    const skippedByUser: CopyPayload[] = []

    for (const payload of payloads) {
        if (skipSourceIds.has(payload.sourceMoneyId)) skippedByUser.push(payload)
        else chosen.push(payload)
    }

    return { chosen, skippedByUser }
}

/** ルールが不正でないか。コピー元と先が同じだと、同じ口座に同じ明細が無限に増える。 */
export function validateCopyRule(input: {
    fromAccountId: number
    toAccountId: number
    lookbackDays: number
}): string | null {
    if (!Number.isInteger(input.fromAccountId) || input.fromAccountId <= 0) {
        return "コピー元の口座を選んでください"
    }
    if (!Number.isInteger(input.toAccountId) || input.toAccountId <= 0) {
        return "コピー先の口座を選んでください"
    }
    if (input.fromAccountId === input.toAccountId) {
        return "コピー元とコピー先には別の口座を選んでください"
    }
    if (!Number.isInteger(input.lookbackDays) || input.lookbackDays < 1 || input.lookbackDays > 365) {
        return "遡る日数は1〜365日で指定してください"
    }
    return null
}
