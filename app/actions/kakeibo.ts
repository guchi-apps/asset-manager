"use server"

/**
 * 家計簿連携（内訳の提案・口座間コピー・Gmail取り込み）のServer Action（Issue #271）。
 *
 * 認可は既存のレシート取込・Zaim連携と同じで、`ZAIM_SYNC_USER_EMAIL` に登録した利用者だけが
 * 使える（`lib/zaim-access.ts`）。Zaimの共有アカウントへ書き込むため、ここを緩めない。
 */

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { isZaimAllowedEmail } from "@/lib/zaim-access"
import {
    applyGenreSuggestions,
    dismissGenreSuggestion,
    getGmailConnectionStatus,
    importFromGmail,
    previewCopyTargets,
    refreshGenreSuggestions,
    runCopyRules,
    updateGenreSuggestion,
    type ApplySuggestionsResult,
    type CopyPreviewResult,
    type CopyRunResult,
    type GmailConnectionStatus,
    type GmailImportResult,
    type SuggestionRefreshResult,
} from "@/lib/kakeibo-service"
import { validateCopyRule } from "@/lib/zaim-copy"
import { validateGmailRule } from "@/lib/gmail-query"
import { toMoneyIdNumber } from "@/lib/zaim-money-id"
import type { ActionResult } from "@/app/actions/receipts"

const NOT_ALLOWED_ERROR =
    "この操作は許可されていません。家計簿連携は管理者のアカウントでのみ利用できます。"

async function authorize(): Promise<{ userId: string } | { error: string }> {
    const user = await getCurrentUser()
    if (!user) return { error: "ログインが必要です" }
    if (!isZaimAllowedEmail(user.email)) return { error: NOT_ALLOWED_ERROR }
    return { userId: user.id }
}

function toError(error: unknown, fallback: string): { success: false; error: string } {
    console.error(fallback + ":", error)
    const message = error instanceof Error ? error.message : String(error)
    return { success: false, error: message || fallback }
}

/* ───────────────────────── 内訳の提案 ───────────────────────── */

export interface GenreSuggestionRow {
    id: number
    zaimMoneyId: number
    date: string
    amount: number
    name: string | null
    place: string | null
    accountName: string | null
    zaimGenreId: number | null
    categoryName: string | null
    genreName: string | null
    confidence: number
    source: string
    reason: string
    /** 画面で最初からチェックを入れてよいか。人が確認済みの分類だけ true。 */
    preselected: boolean
}

export async function getGenreSuggestionsAction(): Promise<ActionResult<GenreSuggestionRow[]>> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }

    try {
        const rows = await prisma.zaimGenreSuggestion.findMany({
            where: { userId: auth.userId, status: "PENDING" },
            orderBy: [{ date: "desc" }, { id: "desc" }],
            take: 300,
        })

        return {
            success: true,
            data: rows.map((row) => ({
                id: row.id,
                zaimMoneyId: toMoneyIdNumber(row.zaimMoneyId),
                date: row.date.toISOString(),
                amount: row.amount,
                name: row.name,
                place: row.place,
                accountName: row.accountName,
                zaimGenreId: row.zaimGenreId,
                categoryName: row.categoryName,
                genreName: row.genreName,
                confidence: row.confidence,
                source: row.source,
                reason: row.reason,
                preselected: row.source !== "AI" && row.zaimGenreId !== null,
            })),
        }
    } catch (error) {
        return toError(error, "内訳の提案を取得できませんでした")
    }
}

export interface ZaimGenreChoice {
    zaimGenreId: number
    categoryName: string
    genreName: string
}

/** 内訳を手で選び直すときの選択肢。マスタに実在する内訳だけを返す。 */
export async function getZaimGenreChoicesAction(): Promise<ActionResult<ZaimGenreChoice[]>> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }

    try {
        const genres = await prisma.zaimGenre.findMany({
            where: { userId: auth.userId, active: true },
            orderBy: [{ categoryName: "asc" }, { sort: "asc" }],
            select: { zaimGenreId: true, categoryName: true, name: true },
        })
        return {
            success: true,
            data: genres.map((genre) => ({
                zaimGenreId: genre.zaimGenreId,
                categoryName: genre.categoryName,
                genreName: genre.name,
            })),
        }
    } catch (error) {
        return toError(error, "内訳の一覧を取得できませんでした")
    }
}

export async function refreshGenreSuggestionsAction(): Promise<
    ActionResult<SuggestionRefreshResult>
> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }

    try {
        const result = await refreshGenreSuggestions(auth.userId)
        revalidatePath("/receipts")
        return { success: true, data: result }
    } catch (error) {
        return toError(error, "Zaimからの読み込みに失敗しました")
    }
}

export async function applyGenreSuggestionsAction(
    suggestionIds: number[]
): Promise<ActionResult<ApplySuggestionsResult>> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }

    try {
        const result = await applyGenreSuggestions(auth.userId, suggestionIds)
        revalidatePath("/receipts")
        return { success: true, data: result }
    } catch (error) {
        return toError(error, "内訳の反映に失敗しました")
    }
}

export async function updateGenreSuggestionAction(
    suggestionId: number,
    zaimGenreId: number
): Promise<ActionResult> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }

    try {
        await updateGenreSuggestion(auth.userId, suggestionId, zaimGenreId)
        return { success: true }
    } catch (error) {
        return toError(error, "内訳の変更に失敗しました")
    }
}

export async function dismissGenreSuggestionAction(suggestionId: number): Promise<ActionResult> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }

    try {
        await dismissGenreSuggestion(auth.userId, suggestionId)
        return { success: true }
    } catch (error) {
        return toError(error, "提案の却下に失敗しました")
    }
}

/* ───────────────────────── 口座間コピー ───────────────────────── */

export interface CopyRuleRow {
    id: number
    fromAccountId: number
    toAccountId: number
    fromAccountName: string
    toAccountName: string
    lookbackDays: number
    enabled: boolean
    autoCopy: boolean
    lastRunAt: string | null
    copiedCount: number
}

export async function getCopyRulesAction(): Promise<ActionResult<CopyRuleRow[]>> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }

    try {
        const rules = await prisma.zaimCopyRule.findMany({
            where: { userId: auth.userId },
            orderBy: { id: "asc" },
            include: { _count: { select: { copies: true } } },
        })

        return {
            success: true,
            data: rules.map((rule) => ({
                id: rule.id,
                fromAccountId: rule.fromAccountId,
                toAccountId: rule.toAccountId,
                fromAccountName: rule.fromAccountName,
                toAccountName: rule.toAccountName,
                lookbackDays: rule.lookbackDays,
                enabled: rule.enabled,
                autoCopy: rule.autoCopy,
                lastRunAt: rule.lastRunAt?.toISOString() ?? null,
                copiedCount: rule._count.copies,
            })),
        }
    } catch (error) {
        return toError(error, "コピールールの取得に失敗しました")
    }
}

export interface CopyRuleInput {
    id?: number
    fromAccountId: number
    toAccountId: number
    lookbackDays: number
    enabled: boolean
    autoCopy: boolean
}

export async function saveCopyRuleAction(input: CopyRuleInput): Promise<ActionResult> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }

    const invalid = validateCopyRule(input)
    if (invalid) return { success: false, error: invalid }

    try {
        // 口座名は表示用なので、保存の時点のマスタから引く。判定はidで行う。
        const accounts = await prisma.zaimAccount.findMany({
            where: {
                userId: auth.userId,
                zaimAccountId: { in: [input.fromAccountId, input.toAccountId] },
            },
            select: { zaimAccountId: true, name: true },
        })
        const nameById = new Map(accounts.map((account) => [account.zaimAccountId, account.name]))
        const fromAccountName = nameById.get(input.fromAccountId)
        const toAccountName = nameById.get(input.toAccountId)
        if (!fromAccountName || !toAccountName) {
            return {
                success: false,
                error: "選んだ口座がZaimのマスタに見つかりません。「Zaimのマスタを更新」を実行してください。",
            }
        }

        const data = {
            fromAccountId: input.fromAccountId,
            toAccountId: input.toAccountId,
            fromAccountName,
            toAccountName,
            lookbackDays: input.lookbackDays,
            enabled: input.enabled,
            autoCopy: input.autoCopy,
        }

        if (input.id) {
            const updated = await prisma.zaimCopyRule.updateMany({
                where: { id: input.id, userId: auth.userId },
                data,
            })
            if (updated.count === 0) return { success: false, error: "ルールが見つかりません" }
        } else {
            const duplicate = await prisma.zaimCopyRule.findFirst({
                where: {
                    userId: auth.userId,
                    fromAccountId: input.fromAccountId,
                    toAccountId: input.toAccountId,
                },
                select: { id: true },
            })
            if (duplicate) {
                return { success: false, error: "同じ口座の組み合わせのルールがすでにあります" }
            }
            await prisma.zaimCopyRule.create({ data: { userId: auth.userId, ...data } })
        }

        revalidatePath("/receipts")
        return { success: true }
    } catch (error) {
        return toError(error, "コピールールの保存に失敗しました")
    }
}

export async function deleteCopyRuleAction(ruleId: number): Promise<ActionResult> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }

    try {
        const deleted = await prisma.zaimCopyRule.deleteMany({
            where: { id: ruleId, userId: auth.userId },
        })
        if (deleted.count === 0) return { success: false, error: "ルールが見つかりません" }
        revalidatePath("/receipts")
        return { success: true }
    } catch (error) {
        return toError(error, "コピールールの削除に失敗しました")
    }
}

/**
 * 実行する前に、複製の対象になる明細を一覧で返す（Issue #286）。
 *
 * **Zaimは読むだけで、この時点では何も書き込まない。** 画面はこの一覧から複製しない明細を
 * 選び、`runCopyRulesAction` の `skipMoneyIds` へ渡す。
 */
export async function previewCopyTargetsAction(): Promise<ActionResult<CopyPreviewResult>> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }

    try {
        return { success: true, data: await previewCopyTargets(auth.userId) }
    } catch (error) {
        return toError(error, "複製対象の読み込みに失敗しました")
    }
}

/**
 * コピールールを実行する。
 *
 * `skipMoneyIds` はプレビューでチェックを外した複製元のZaim明細id（Issue #286）。DBには
 * 残さず、実行のたびに画面から渡してもらう。渡さなければ従来どおり全件を複製する。
 */
export async function runCopyRulesAction(
    options: { skipMoneyIds?: number[] } = {}
): Promise<ActionResult<CopyRunResult>> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }

    // クライアントから来る値なので、idとして使える整数だけに絞ってから渡す。
    const skipMoneyIds = (options.skipMoneyIds ?? []).filter(
        (id) => Number.isInteger(id) && id > 0
    )

    try {
        const result = await runCopyRules(auth.userId, { skipMoneyIds })
        revalidatePath("/receipts")
        return { success: true, data: result }
    } catch (error) {
        return toError(error, "明細の複製に失敗しました")
    }
}

/* ───────────────────────── Gmail取り込み ───────────────────────── */

export interface GmailRuleRow {
    id: number
    name: string
    fromQuery: string
    subjectQuery: string
    extraQuery: string
    lookbackDays: number
    enabled: boolean
    lastRunAt: string | null
    importedCount: number
}

export async function getGmailRulesAction(): Promise<ActionResult<GmailRuleRow[]>> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }

    try {
        const rules = await prisma.gmailImportRule.findMany({
            where: { userId: auth.userId },
            orderBy: { id: "asc" },
        })
        return {
            success: true,
            data: rules.map((rule) => ({
                id: rule.id,
                name: rule.name,
                fromQuery: rule.fromQuery,
                subjectQuery: rule.subjectQuery,
                extraQuery: rule.extraQuery,
                lookbackDays: rule.lookbackDays,
                enabled: rule.enabled,
                lastRunAt: rule.lastRunAt?.toISOString() ?? null,
                importedCount: rule.importedCount,
            })),
        }
    } catch (error) {
        return toError(error, "Gmailの条件の取得に失敗しました")
    }
}

export interface GmailRuleInput {
    id?: number
    name: string
    fromQuery: string
    subjectQuery: string
    extraQuery: string
    lookbackDays: number
    enabled: boolean
}

export async function saveGmailRuleAction(input: GmailRuleInput): Promise<ActionResult> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }

    const invalid = validateGmailRule(input)
    if (invalid) return { success: false, error: invalid }

    const data = {
        name: input.name.trim(),
        fromQuery: input.fromQuery.trim(),
        subjectQuery: input.subjectQuery.trim(),
        extraQuery: input.extraQuery.trim(),
        lookbackDays: input.lookbackDays,
        enabled: input.enabled,
    }

    try {
        if (input.id) {
            const updated = await prisma.gmailImportRule.updateMany({
                where: { id: input.id, userId: auth.userId },
                data,
            })
            if (updated.count === 0) return { success: false, error: "条件が見つかりません" }
        } else {
            await prisma.gmailImportRule.create({ data: { userId: auth.userId, ...data } })
        }
        revalidatePath("/receipts")
        return { success: true }
    } catch (error) {
        return toError(error, "Gmailの条件の保存に失敗しました")
    }
}

export async function deleteGmailRuleAction(ruleId: number): Promise<ActionResult> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }

    try {
        const deleted = await prisma.gmailImportRule.deleteMany({
            where: { id: ruleId, userId: auth.userId },
        })
        if (deleted.count === 0) return { success: false, error: "条件が見つかりません" }
        revalidatePath("/receipts")
        return { success: true }
    } catch (error) {
        return toError(error, "Gmailの条件の削除に失敗しました")
    }
}

/**
 * Gmailを取り込む。取り込みのあとに、自動に設定したコピールールを続けて実行する（#271）。
 *
 * 「自動」の意味をここに固定している。取り込み・確定と切り離した定期実行は用意していないため、
 * 自動コピーが走るのは取り込み操作の直後だけになる。
 */
export async function importFromGmailAction(): Promise<
    ActionResult<{ gmail: GmailImportResult; copy: CopyRunResult }>
> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }

    try {
        const gmail = await importFromGmail(auth.userId)
        const copy = await runCopyRules(auth.userId, { onlyAuto: true })
        revalidatePath("/receipts")
        return { success: true, data: { gmail, copy } }
    } catch (error) {
        return toError(error, "Gmailからの取り込みに失敗しました")
    }
}

export async function getGmailConnectionAction(): Promise<ActionResult<GmailConnectionStatus>> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }

    try {
        return { success: true, data: await getGmailConnectionStatus() }
    } catch (error) {
        return toError(error, "Gmailの接続状態を確認できませんでした")
    }
}
