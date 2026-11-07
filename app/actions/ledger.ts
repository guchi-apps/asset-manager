"use server"

/**
 * 家計簿画面のサーバーアクション（Issue #815）。
 *
 * 読み書きの中身は `lib/ledger-service.ts`、入力の検証は `lib/ledger-input.ts` にあり、ここは認証と再検証だけを担う。
 */

import { revalidatePath } from "next/cache"
import { revalidateUserDashboard } from "@/lib/dashboard-cache"

import { getCurrentUser, getCurrentUserId } from "@/lib/auth"
import { isZaimAllowedEmail } from "@/lib/zaim-access"
import { loadSpendPace } from "@/lib/ledger-pace-service"
import type { SpendPace } from "@/lib/ledger-pace"
import { syncZaimLedger } from "@/lib/ledger-sources/zaim/fetch"
import { describeLinkedReceiptSync, syncLinkedReceipts } from "@/lib/linked-receipt-sync"
import { loadExternalBalances, type ExternalBalancesView } from "@/lib/ledger-external-balance-service"
import { getCalendarDayKey } from "@/lib/valuation-day"
import { parseReconcileMode, type ReconcileMode } from "@/lib/ledger-external-balance"
import {
    loadLedgerSyncStatus,
    resolveChangedRecord,
    resolveMissingRecord,
    setSourceStartDate,
    type LedgerSyncStatusView,
} from "@/lib/ledger-sources/review-service"
import {
    createAccount,
    createCategory,
    createEntry,
    createSettlement,
    deleteAccount,
    deleteCategory,
    deleteEntry,
    getAccountDeletionImpact,
    getAccountMergeImpact,
    loadAccountHistory,
    loadDebtPage,
    loadLedgerPage,
    mergeAccount,
    mergeCategory,
    reorderLedgerAccounts,
    reorderLedgerCategories,
    setAccountBalance,
    reconcileAccountBalances,
    setAccountHidden,
    renameAccountGroup,
    saveAccountGroup,
    setCategoryHidden,
    setCategoryWorkRelated,
    setPeriodMode,
    suggestOpeningBalance,
    updateAccount,
    updateCategory,
    updateEntry,
    updateSettlement,
    type AccountDeletionImpact,
    type AccountMergeImpact,
    type LedgerAccountHistoryData,
    type LedgerDebtPageData,
    type LedgerPageData,
    type OpeningBalanceSuggestion,
} from "@/lib/ledger-service"
import {
    isValidIsoDate,
    parseAccountInput,
    SHORT_NAME_MAX,
    parseCategoryInput,
    parseEntryInput,
    parseIdList,
    parseSettlementInput,
    parseYen,
    type AccountInput,
    type CategoryInput,
    type EntryInput,
    type SettlementInput,
} from "@/lib/ledger-input"
import { normalizePeriodMode } from "@/lib/ledger-period"
import { loadLedgerSummary, type LedgerSummaryPageData } from "@/lib/ledger-summary-service"
import { loadHouseholdAnalysis,type AnalysisUnit, type HouseholdAnalysis } from "@/lib/ledger-analysis-service"
import {
    deleteOffsettingAdjustmentPairs,
    findOffsettingAdjustmentCandidates,
    importZaimCsv,
    listImportBatches,
    previewZaimCsv,
    undoImportBatch,
    type CsvImportResult,
    type CsvPreview,
    type ImportBatchView,
    type OffsettingAdjustmentCandidate,
} from "@/lib/ledger-sources/csv-service"
import { parseSelection, type AttachSelection } from "@/lib/ledger-attach-preview"
import {
    attachToStatement,
    countStatementCandidates,
    loadAttachPreview,
    loadLinkedReceipts,
    loadReceiptLedgerAccounts,
    loadReceiptLedgerState,
    loadStatementCandidates,
    loadStatementSuggestions,
    rejectStatementCandidate,
    registerReceiptToLedger,
    rejectMatchCandidate,
    releaseOrphanedMatches,
    resolveMatchPending,
    resolveMatchPendingBulk,
    settleUnassignedPending,
    unregisterReceiptFromLedger,
    type AttachOptions,
    type AttachPreviewView,
    type LinkedReceiptView,
    type RegisterResult,
    type StatementCandidateRef,
    type StatementCandidatesView,
} from "@/lib/ledger-receipt-service"
import {
    applySourceMappings,
    createAccountsForUnmapped,
    loadMappingOverview,
    setAccountMapping,
    setCategoryMapping,
    type MappingOverview,
} from "@/lib/ledger-sources/mapping-service"
import {
    applyClassificationRules,
    createRule,
    deleteRule,
    loadRuleOverview,
    moveRule,
    previewRule,
    updateRule,
    type ApplyRulesResult,
    type RulePreview,
    type RuleOverview,
} from "@/lib/ledger-rule-service"
import {
    linkSubscriptionToEntry,
    loadSubscriptionAttachPreview,
    loadSubscriptionLinkState,
    rejectSubscriptionCandidate,
    unlinkSubscriptionFromEntry,
    type LedgerSubscriptionState,
    type SubscriptionAttachPreviewView,
} from "@/lib/ledger-subscription-service"
import { parseSubscriptionSelection, type SubscriptionAttachSelection } from "@/lib/ledger-subscription-attach"
import { parseRuleInput, type RuleInput } from "@/lib/ledger-rules"
import {
    adoptAiSuggestions,
    classifyUnclassifiedWithAi,
    suggestCategoryForDraft,
    type AiClassifyResult,
    type DraftSubject,
} from "@/lib/ledger-ai-classify-service"
import {
    applyCategoryImport,
    presetCategoryImportText,
    previewCategoryImport,
    type CategoryImportPreview,
    type CategoryImportResult,
} from "@/lib/ledger-category-import-service"

export type LedgerActionResult = { success: true } | { success: false; error: string }

const LEDGER_PATH = "/ledger"

async function run(label: string, fn: (userId: string) => Promise<void>): Promise<LedgerActionResult> {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }
        await fn(userId)
        // 確認待ちの画面（/ledger/review）も同じ取引を出すので、配下ごと再検証する
        revalidatePath(LEDGER_PATH, "layout")
        return { success: true }
    } catch (error) {
        console.error(`[ledger:${label}]`, error)
        const message = error instanceof Error ? error.message : ""
        return { success: false, error: message || "保存に失敗しました" }
    }
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
    if (!result.ok) throw new Error(result.error)
    return result.value
}

export async function getLedgerPageData(offset = 0): Promise<LedgerPageData | null> {
    const userId = await getCurrentUserId()
    if (!userId) return null
    return loadLedgerPage(userId, offset)
}

/** 家計簿トップの支出ペース（#876）。ホームでは使わないので `getLedgerPageData` とは別にする */
export async function getSpendPace(offset = 0): Promise<SpendPace | null> {
    const userId = await getCurrentUserId()
    if (!userId) return null
    return loadSpendPace(userId, offset)
}

/** 家計簿の「サマリー」タブ（#983）。取引明細の期間とは別に、月か年で集計する */
export async function getLedgerSummary(unit: AnalysisUnit = "month", offset = 0): Promise<LedgerSummaryPageData | null> {
    const userId = await getCurrentUserId()
    if (!userId) return null
    return loadLedgerSummary(userId, unit === "year" ? "year" : "month", offset)
}

/* 取引 */

export async function createEntryAction(input: EntryInput): Promise<LedgerActionResult> {
    return run("createEntry", async (userId) => {
        await createEntry(userId, unwrap(parseEntryInput(input)))
    })
}

export async function updateEntryAction(id: number, input: EntryInput): Promise<LedgerActionResult> {
    return run("updateEntry", async (userId) => {
        await updateEntry(userId, id, unwrap(parseEntryInput(input)))
        // 反映待ちの金額・日付を直すと、照合待ちのカード明細の候補から外れることがある（#859）
        await releaseOrphanedMatches(userId)
    })
}

export async function deleteEntryAction(id: number): Promise<LedgerActionResult> {
    return run("deleteEntry", async (userId) => {
        await deleteEntry(userId, id)
        await releaseOrphanedMatches(userId)
    })
}

/** 口座の履歴ページ（#900） */
export async function getAccountHistory(accountId: number, limit: number): Promise<LedgerAccountHistoryData | null> {
    const userId = await getCurrentUserId()
    if (!userId) return null
    return loadAccountHistory(userId, accountId, limit)
}

/* 立て替え・後払い（#880） */

export async function getLedgerDebtPageData(): Promise<LedgerDebtPageData | null> {
    const userId = await getCurrentUserId()
    if (!userId) return null
    return loadDebtPage(userId)
}

/** 回収・支払いを記録する。`id` を渡すと、その精算の取引を直す */
export async function saveSettlementAction(input: SettlementInput, id?: number): Promise<LedgerActionResult> {
    return run("saveSettlement", async (userId) => {
        const parsed = unwrap(parseSettlementInput(input))
        if (id != null) await updateSettlement(userId, id, parsed)
        else await createSettlement(userId, parsed)
    })
}

export async function setPeriodModeAction(mode: string): Promise<LedgerActionResult> {
    return run("setPeriodMode", (userId) => setPeriodMode(userId, normalizePeriodMode(mode)))
}

/* 口座 */

export async function createAccountAction(input: AccountInput): Promise<LedgerActionResult> {
    return run("createAccount", async (userId) => {
        await createAccount(userId, unwrap(parseAccountInput(input)))
        // 口座の用途はホーム・投資資産の集計に効くので、集計のキャッシュも捨てる（#965）
        revalidateUserDashboard(userId)
    })
}

export async function updateAccountAction(id: number, input: AccountInput): Promise<LedgerActionResult> {
    return run("updateAccount", async (userId) => {
        await updateAccount(userId, id, unwrap(parseAccountInput(input)))
        revalidateUserDashboard(userId)
    })
}

export async function renameAccountGroupAction(from: string, to: string): Promise<LedgerActionResult> {
    return run("renameAccountGroup", async (userId) => {
        const name = to.trim()
        if (name.length > SHORT_NAME_MAX) throw new Error(`グループ名は${SHORT_NAME_MAX}文字以内で入力してください`)
        await renameAccountGroup(userId, from, name === "" ? null : name)
    })
}

/** 口座グループの作成（`from` が null）・編集（#1066）。名前と、グループに入れる口座をまとめて保存する */
export async function saveAccountGroupAction(from: string | null, name: string, accountIds: number[]): Promise<LedgerActionResult> {
    return run("saveAccountGroup", async (userId) => {
        const trimmed = (name ?? "").trim()
        if (trimmed === "") throw new Error("グループ名を入力してください")
        if (trimmed.length > SHORT_NAME_MAX) throw new Error(`グループ名は${SHORT_NAME_MAX}文字以内で入力してください`)
        await saveAccountGroup(userId, from, trimmed, Array.isArray(accountIds) ? accountIds.map(Number) : [])
    })
}

export async function setAccountHiddenAction(id: number, hidden: boolean): Promise<LedgerActionResult> {
    return run("setAccountHidden", async (userId) => {
        await setAccountHidden(userId, id, hidden)
        revalidateUserDashboard(userId)
    })
}

export async function getAccountDeletionImpactAction(
    id: number
): Promise<{ success: true; impact: AccountDeletionImpact } | { success: false; error: string }> {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }
        return { success: true, impact: await getAccountDeletionImpact(userId, id) }
    } catch (error) {
        console.error("[ledger:getAccountDeletionImpact]", error)
        return { success: false, error: error instanceof Error && error.message ? error.message : "件数を読めませんでした" }
    }
}

/** 口座と、その口座の取引をすべて消す（#899）。口座名の入力で確かめる */
export async function deleteAccountAction(id: number, confirmName: string): Promise<LedgerActionResult> {
    return run("deleteAccount", async (userId) => {
        await deleteAccount(userId, id, confirmName)
        // 消えた取引が候補だった照合待ちを、確定に戻す
        await releaseOrphanedMatches(userId)
    })
}

export async function getAccountMergeImpactAction(
    sourceId: number,
    targetId: number
): Promise<{ success: true; impact: AccountMergeImpact } | { success: false; error: string }> {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }
        return { success: true, impact: await getAccountMergeImpact(userId, sourceId, targetId) }
    } catch (error) {
        console.error("[ledger:getAccountMergeImpact]", error)
        return { success: false, error: error instanceof Error && error.message ? error.message : "件数を読めませんでした" }
    }
}

/** 口座を別の口座へ結合する（#973）。結合元の取引などを結合先へ付け替えて結合元を消す。結合元の口座名の入力で確かめる */
export async function mergeAccountAction(sourceId: number, targetId: number, confirmName: string): Promise<LedgerActionResult> {
    return run("mergeAccount", async (userId) => {
        await mergeAccount(userId, sourceId, targetId, confirmName)
        // 消えた振替が候補だった照合待ちを、確定に戻す
        await releaseOrphanedMatches(userId)
        // 口座の残高・用途はホーム・投資資産の集計に効く（#965）
        revalidateUserDashboard(userId)
    })
}

export async function setAccountBalanceAction(
    id: number,
    balance: string,
    date: string
): Promise<LedgerActionResult> {
    return run("setAccountBalance", async (userId) => {
        const target = parseYen(balance)
        if (target === null) throw new Error("残高は整数で入力してください")
        if (!isValidIsoDate(date)) throw new Error("日付が正しくありません")
        const changed = await setAccountBalance(userId, id, target, date)
        if (!changed) throw new Error("今の残高と同じです")
    })
}

/**
 * 明細が届く口座の、Zaimの現在の残高（#881）。Zaimのデータを読むので、取り込みと同じく管理者のアカウントだけ。
 * 使えないときは null（画面は家計簿の計算の残高だけを出す）
 */
export async function getExternalBalancesAction(): Promise<
    { success: true; data: ExternalBalancesView } | { success: false; error: string } | null
> {
    try {
        const user = await getCurrentUser()
        if (!user || !isZaimAllowedEmail(user.email)) return null
        return { success: true, data: await loadExternalBalances(user.id) }
    } catch (error) {
        console.error("[ledger:externalBalances]", error)
        return { success: false, error: error instanceof Error ? error.message : "Zaimの残高を読めませんでした" }
    }
}

/**
 * 選んだ口座の残高（家計簿の計算）を、Zaimの現在の残高に合わせる。
 * 既定は差を初期残高へ足す。`adjustment` を選ぶと今日の残高調整の取引として残す。
 * 合わせる先の金額は画面から受け取らず、ここでZaimの残高を読み直して使う（画面を開いたあとに変わっていても今の値に合う）。
 */
export async function reconcileExternalBalancesAction(
    accountIds: number[],
    mode: ReconcileMode = "opening"
): Promise<{ success: true; adjusted: number; skipped: number } | { success: false; error: string }> {
    try {
        const user = await getCurrentUser()
        if (!user) return { success: false, error: "ログインが必要です" }
        if (!isZaimAllowedEmail(user.email)) return { success: false, error: "Zaimの残高は管理者のアカウントでのみ利用できます" }
        const wanted = new Set((Array.isArray(accountIds) ? accountIds : []).map(Number).filter(Number.isInteger))
        if (wanted.size === 0) return { success: false, error: "口座を選んでください" }
        const { balances } = await loadExternalBalances(user.id)
        const targets = balances
            .filter((b) => wanted.has(b.accountId))
            .map((b) => ({ accountId: b.accountId, target: b.amount, zaimName: b.zaimName }))
        if (targets.length === 0) return { success: false, error: "Zaimの残高が見つかる口座がありません" }
        const result = await reconcileAccountBalances(user.id, targets, getCalendarDayKey(new Date()), parseReconcileMode(mode))
        revalidatePath(LEDGER_PATH, "layout")
        return { success: true, adjusted: result.adjusted.length, skipped: result.skipped.length }
    } catch (error) {
        console.error("[ledger:reconcileExternalBalances]", error)
        return { success: false, error: error instanceof Error ? error.message : "残高を合わせられませんでした" }
    }
}

export async function suggestOpeningBalanceAction(
    assetCategoryIds: number[],
    openingDate: string
): Promise<OpeningBalanceSuggestion | null> {
    const userId = await getCurrentUserId()
    if (!userId || !isValidIsoDate(openingDate)) return null
    return suggestOpeningBalance(userId, parseIdList(assetCategoryIds), openingDate)
}

/* カテゴリ */

export async function createCategoryAction(input: CategoryInput): Promise<LedgerActionResult> {
    return run("createCategory", (userId) => createCategory(userId, unwrap(parseCategoryInput(input))))
}

export async function updateCategoryAction(id: number, input: CategoryInput): Promise<LedgerActionResult> {
    return run("updateCategory", (userId) => updateCategory(userId, id, unwrap(parseCategoryInput(input))))
}

export async function setCategoryHiddenAction(id: number, hidden: boolean): Promise<LedgerActionResult> {
    return run("setCategoryHidden", (userId) => setCategoryHidden(userId, id, hidden))
}

export async function setCategoryWorkRelatedAction(id: number, workRelated: boolean): Promise<LedgerActionResult> {
    return run("setCategoryWorkRelated", (userId) => setCategoryWorkRelated(userId, id, workRelated === true))
}

export async function reorderLedgerCategoriesAction(
    kind: "EXPENSE" | "INCOME",
    parentId: number | null,
    orderedIds: number[]
): Promise<LedgerActionResult> {
    return run("reorderLedgerCategories", (userId) =>
        reorderLedgerCategories(
            userId,
            kind === "INCOME" ? "INCOME" : "EXPENSE",
            parentId == null ? null : Number(parentId),
            Array.isArray(orderedIds) ? orderedIds.map(Number) : []
        )
    )
}

export async function reorderLedgerAccountsAction(orderedIds: number[]): Promise<LedgerActionResult> {
    return run("reorderLedgerAccounts", (userId) =>
        reorderLedgerAccounts(userId, Array.isArray(orderedIds) ? orderedIds.map(Number) : [])
    )
}

export async function deleteCategoryAction(id: number): Promise<LedgerActionResult> {
    return run("deleteCategory", (userId) => deleteCategory(userId, id))
}

export async function mergeCategoryAction(sourceId: number, targetId: number): Promise<LedgerActionResult> {
    return run("mergeCategory", async (userId) => {
        await mergeCategory(userId, sourceId, targetId)
    })
}

/* 取り込み元の名前の対応（Issue #816） */

export async function getMappingOverview(): Promise<MappingOverview | null> {
    const userId = await getCurrentUserId()
    if (!userId) return null
    return loadMappingOverview(userId)
}

export async function setAccountMappingAction(
    provider: string,
    externalName: string,
    value: string
): Promise<LedgerActionResult> {
    // value: "unset" / "info" / 口座id
    return run("setAccountMapping", async (userId) => {
        if (value === "unset") await setAccountMapping(userId, provider, externalName, null, null)
        else if (value === "info") await setAccountMapping(userId, provider, externalName, "INFO_SOURCE", null)
        else await setAccountMapping(userId, provider, externalName, "ACCOUNT", Number(value))
        await applySourceMappings(userId, provider)
    })
}

export async function createAccountsForUnmappedAction(provider: string, names: string[]): Promise<LedgerActionResult> {
    return run("createAccountsForUnmapped", async (userId) => {
        await createAccountsForUnmapped(userId, provider, names.filter((n) => typeof n === "string" && n.trim()))
        await applySourceMappings(userId, provider)
    })
}

export async function setCategoryMappingAction(
    provider: string,
    externalCategory: string,
    externalGenre: string,
    value: string
): Promise<LedgerActionResult> {
    return run("setCategoryMapping", async (userId) => {
        await setCategoryMapping(userId, provider, externalCategory, externalGenre, value === "unset" ? null : Number(value))
        await applySourceMappings(userId, provider)
    })
}

export async function applySourceMappingsAction(provider: string): Promise<LedgerActionResult> {
    return run("applySourceMappings", async (userId) => {
        await applySourceMappings(userId, provider)
    })
}

/* カテゴリ体系と対応表の一括読み込み（Issue #833） */

/** 読み込むファイルの中身。null なら「おすすめの体系」（`lib/ledger-category-presets/zaim.json`） */
function categoryImportText(text: string | null): string {
    if (text === null) return presetCategoryImportText()
    if (typeof text !== "string" || !text.trim()) throw new Error("ファイルが空です")
    if (text.length > 512 * 1024) throw new Error("ファイルが大きすぎます（512KBまで）")
    return text
}

export async function previewCategoryImportAction(
    text: string | null
): Promise<{ success: true; data: CategoryImportPreview } | { success: false; error: string }> {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }
        return { success: true, data: await previewCategoryImport(userId, categoryImportText(text)) }
    } catch (error) {
        console.error("[ledger:previewCategoryImport]", error)
        return { success: false, error: error instanceof Error ? error.message : "ファイルを読めませんでした" }
    }
}

export async function applyCategoryImportAction(
    text: string | null
): Promise<{ success: true; data: CategoryImportResult } | { success: false; error: string }> {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }
        const data = await applyCategoryImport(userId, categoryImportText(text))
        revalidatePath(LEDGER_PATH)
        return { success: true, data }
    } catch (error) {
        console.error("[ledger:applyCategoryImport]", error)
        return { success: false, error: error instanceof Error ? error.message : "読み込みに失敗しました" }
    }
}

/* 分類ルール（Issue #834） */

export type RuleActionResult = { success: true; data: ApplyRulesResult } | { success: false; error: string }

/** ルールを変えたら、取り込み済みの取引へすぐ当て直す */
async function runRule(label: string, fn: (userId: string) => Promise<void>): Promise<RuleActionResult> {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }
        await fn(userId)
        const data = await applyClassificationRules(userId)
        revalidatePath(LEDGER_PATH)
        return { success: true, data }
    } catch (error) {
        console.error(`[ledger:${label}]`, error)
        const message = error instanceof Error ? error.message : ""
        return { success: false, error: message || "保存に失敗しました" }
    }
}

export async function getRuleOverview(): Promise<RuleOverview | null> {
    const userId = await getCurrentUserId()
    if (!userId) return null
    return loadRuleOverview(userId)
}

export async function createRuleAction(input: RuleInput): Promise<RuleActionResult> {
    return runRule("createRule", async (userId) => {
        await createRule(userId, unwrapRule(input))
    })
}

export async function updateRuleAction(id: number, input: RuleInput): Promise<RuleActionResult> {
    return runRule("updateRule", async (userId) => {
        await updateRule(userId, id, unwrapRule(input))
    })
}

export async function deleteRuleAction(id: number): Promise<RuleActionResult> {
    return runRule("deleteRule", async (userId) => {
        await deleteRule(userId, id)
    })
}

export async function moveRuleAction(id: number, direction: "up" | "down"): Promise<RuleActionResult> {
    return runRule("moveRule", async (userId) => {
        await moveRule(userId, id, direction === "up" ? "up" : "down")
    })
}

/** 未分類の品目をAI（Jev）で分類する（#841）。分類ルールの画面のボタンから */
export async function classifyWithAiAction(): Promise<{ success: true; data: AiClassifyResult } | { success: false; error: string }> {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }
        const data = await classifyUnclassifiedWithAi(userId)
        if (data.skipped) return { success: false, error: "AIのAPIキー（TYPESAFE_API_KEY）が設定されていません" }
        revalidatePath(LEDGER_PATH)
        return { success: true, data }
    } catch (error) {
        console.error("[ledger:classifyWithAi]", error)
        return { success: false, error: error instanceof Error ? error.message : "AIでの分類に失敗しました" }
    }
}

/** AIの候補をまとめて採用する（#848）。候補の確認画面で選んだ品目だけを渡す */
export async function adoptAiSuggestionsAction(
    lineIds: number[]
): Promise<{ success: true; data: { adopted: number } } | { success: false; error: string }> {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }
        if (!Array.isArray(lineIds) || !lineIds.every((id) => Number.isInteger(id))) return { success: false, error: "品目の指定が正しくありません" }
        const data = await adoptAiSuggestions(userId, lineIds)
        revalidatePath(LEDGER_PATH)
        return { success: true, data }
    } catch (error) {
        console.error("[ledger:adoptAiSuggestions]", error)
        return { success: false, error: error instanceof Error ? error.message : "候補の採用に失敗しました" }
    }
}

/** 取引編集で開いた未分類の品目に、Jevの候補を1件返す（#932）。保存はしない */
export async function suggestCategoryAction(
    input: DraftSubject
): Promise<{ success: true; data: { categoryId: number; label: string } | null } | { success: false; error: string }> {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }
        const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 191) : null)
        if (input?.kind !== "EXPENSE" && input?.kind !== "INCOME") return { success: false, error: "種別が正しくありません" }
        if (!Number.isFinite(input.amount)) return { success: false, error: "金額が正しくありません" }
        const picked = await suggestCategoryForDraft(userId, {
            kind: input.kind,
            place: text(input.place),
            name: text(input.name),
            memo: text(input.memo),
            amount: Math.trunc(input.amount),
            accountId: Number.isInteger(input.accountId) ? input.accountId : null,
        })
        return { success: true, data: picked ? { categoryId: picked.id, label: picked.label } : null }
    } catch (error) {
        console.error("[ledger:suggestCategory]", error)
        return { success: false, error: error instanceof Error ? error.message : "候補の取得に失敗しました" }
    }
}

/** 保存する前の下見（#822） */
export async function previewRuleAction(
    input: RuleInput
): Promise<{ success: true; data: RulePreview } | { success: false; error: string }> {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }
        return { success: true, data: await previewRule(userId, unwrapRule(input)) }
    } catch (error) {
        console.error("[ledger:previewRule]", error)
        return { success: false, error: error instanceof Error ? error.message : "下見に失敗しました" }
    }
}

export async function applyRulesAction(): Promise<RuleActionResult> {
    return runRule("applyRules", async () => {})
}

function unwrapRule(input: RuleInput) {
    const parsed = parseRuleInput(input)
    if (!parsed.ok) throw new Error(parsed.error)
    return parsed.value
}

/* Zaim明細の取り込み（Issue #817） */

export async function getLedgerSyncStatus(): Promise<LedgerSyncStatusView | null> {
    const userId = await getCurrentUserId()
    if (!userId) return null
    return loadLedgerSyncStatus(userId)
}

/** 確認待ちの画面（/ledger/review）で口座を選ぶための、表示中の口座（#859） */
export async function getSelectableLedgerAccounts(): Promise<{ id: number; name: string; kind: string }[] | null> {
    const userId = await getCurrentUserId()
    if (!userId) return null
    const state = await loadReceiptLedgerAccounts(userId)
    return state
}

export async function setSourceStartDateAction(date: string): Promise<LedgerActionResult> {
    return run("setSourceStartDate", async (userId) => {
        if (date !== "" && !isValidIsoDate(date)) throw new Error("日付が正しくありません")
        await setSourceStartDate(userId, date === "" ? null : date)
    })
}

/** 画面の「今すぐ取り込む」。Zaimの明細を読むので、Zaim連携を許可した利用者だけが使える（`lib/zaim-access.ts`） */
export async function runLedgerSyncAction(): Promise<{ success: true; message: string } | { success: false; error: string }> {
    try {
        const user = await getCurrentUser()
        if (!user) return { success: false, error: "ログインが必要です" }
        if (!isZaimAllowedEmail(user.email)) return { success: false, error: "Zaimからの取り込みは管理者のアカウントでのみ利用できます" }
        const result = await syncZaimLedger(user.id, { trigger: "MANUAL" })
        revalidatePath(LEDGER_PATH)
        if (result.status === "FAILED") return { success: false, error: result.message }
        // 続けてスマートレシート・Amazonの明細を取り込む（#1005）。失敗しても家計簿の取り込みは成功のまま返す
        let linked: string
        try {
            linked = describeLinkedReceiptSync(await syncLinkedReceipts(user.id))
        } catch (error) {
            console.error("[ledger:runLedgerSync] スマートレシート・Amazonの取り込みに失敗しました", error)
            linked = `スマートレシート・Amazonの取り込みに失敗しました（${error instanceof Error ? error.message : "理由不明"}）`
        }
        revalidatePath("/receipts")
        return { success: true, message: `${result.message} / ${linked}` }
    } catch (error) {
        console.error("[ledger:runLedgerSync]", error)
        return { success: false, error: error instanceof Error ? error.message : "取り込みに失敗しました" }
    }
}

export async function resolveChangedRecordAction(recordId: number, choice: string): Promise<LedgerActionResult> {
    return run("resolveChangedRecord", (userId) => resolveChangedRecord(userId, recordId, choice === "source" ? "source" : "keep"))
}

export async function resolveMissingRecordAction(recordId: number, choice: string): Promise<LedgerActionResult> {
    return run("resolveMissingRecord", (userId) =>
        resolveMissingRecord(userId, recordId, choice === "delete" ? "delete" : choice === "exclude" ? "exclude" : "keep")
    )
}

/* 家計の分析（Issue #821） */

export async function getHouseholdAnalysis(
    offset = 0,
    excludeWork = false,
    unit: AnalysisUnit = "month"
): Promise<HouseholdAnalysis | null> {
    const userId = await getCurrentUserId()
    if (!userId) return null
    return loadHouseholdAnalysis(userId, offset, excludeWork === true, unit)
}

/* レシート・メールを家計簿へ（Issue #818） */

/** 付けるときの画面からの指定（#947）。項目ごとの「変更する」と、プレビューを開いた時点の取引の更新時刻 */
export type AttachRequest = { select?: Partial<AttachSelection>; expectedUpdatedAt?: string }

function parseAttachRequest(value: AttachRequest | undefined): AttachOptions {
    if (!value || typeof value !== "object") return {}
    const expected = typeof value.expectedUpdatedAt === "string" && Number.isFinite(new Date(value.expectedUpdatedAt).getTime()) ? value.expectedUpdatedAt : undefined
    return { select: parseSelection(value.select), ...(expected ? { expectedUpdatedAt: expected } : {}) }
}

/** 付ける前の変更プレビュー。付けられない組なら理由を返す。`accountId` はレシート詳細から付けるときの支払い口座 */
export async function getAttachPreviewAction(
    entryId: number,
    receiptId: number,
    accountId: number | null = null
): Promise<{ success: true; data: AttachPreviewView } | { success: false; error: string }> {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }
        if (!Number.isInteger(entryId) || !Number.isInteger(receiptId)) return { success: false, error: "指定が正しくありません" }
        return { success: true, data: await loadAttachPreview(userId, entryId, receiptId, Number.isInteger(accountId) ? accountId : null) }
    } catch (error) {
        console.error("[ledger:attachPreview]", error)
        return { success: false, error: error instanceof Error ? error.message : "変更内容を読めませんでした" }
    }
}

/** 取引に付いているレシート・メール（取引の編集画面に出す） */
export async function getLinkedReceiptsAction(entryId: number): Promise<LinkedReceiptView[]> {
    const userId = await getCurrentUserId()
    if (!userId || !Number.isInteger(entryId)) return []
    return loadLinkedReceipts(userId, entryId)
}

export type ReceiptLedgerState = Awaited<ReturnType<typeof loadReceiptLedgerState>>

export async function getReceiptLedgerStateAction(receiptId: number): Promise<ReceiptLedgerState | null> {
    const userId = await getCurrentUserId()
    if (!userId) return null
    return loadReceiptLedgerState(userId, receiptId)
}

/** `accountId` が null なら「あとで決める（カード明細と照合）」（#859） */
export async function registerReceiptToLedgerAction(
    receiptId: number,
    accountId: number | null,
    targetEntryId?: number,
    attach?: AttachRequest
): Promise<{ success: true; data: RegisterResult } | { success: false; error: string }> {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }
        const data = await registerReceiptToLedger(userId, receiptId, accountId, targetEntryId, parseAttachRequest(attach))
        revalidatePath(LEDGER_PATH, "layout")
        revalidatePath("/receipts")
        return { success: true, data }
    } catch (error) {
        console.error("[ledger:registerReceipt]", error)
        return { success: false, error: error instanceof Error ? error.message : "登録に失敗しました" }
    }
}

export async function unregisterReceiptFromLedgerAction(receiptId: number): Promise<LedgerActionResult> {
    return run("unregisterReceipt", async (userId) => {
        await unregisterReceiptFromLedger(userId, receiptId)
        revalidatePath("/receipts")
    })
}

export async function resolveMatchPendingAction(entryId: number, choice: string): Promise<LedgerActionResult> {
    return run("resolveMatchPending", (userId) =>
        resolveMatchPending(userId, entryId, choice === "separate" ? "separate" : Number(choice))
    )
}

/** 照合待ちのカード明細の候補から「違う」と言った取引を外す（#859） */
export async function rejectMatchCandidateAction(entryId: number, candidateId: number): Promise<LedgerActionResult> {
    return run("rejectMatchCandidate", (userId) => rejectMatchCandidate(userId, entryId, candidateId))
}

/** 一致の度合いが高い組をまとめて確定する（#859）。確定した件数を返す */
export async function resolveMatchPendingBulkAction(
    pairs: { entryId: number; candidateId: number }[]
): Promise<{ success: true; count: number } | { success: false; error: string }> {
    let count = 0
    const result = await run("resolveMatchPendingBulk", async (userId) => {
        count = await resolveMatchPendingBulk(
            userId,
            (Array.isArray(pairs) ? pairs : []).filter((p) => Number.isInteger(p?.entryId) && Number.isInteger(p?.candidateId))
        )
    })
    return result.success ? { success: true, count } : result
}

/** 口座未定のままカード明細が届かない反映待ちを片付ける（#859）。choice: 口座id / "cash" / "cancel" */
export async function settleUnassignedPendingAction(entryId: number, choice: string): Promise<LedgerActionResult> {
    return run("settleUnassignedPending", (userId) =>
        settleUnassignedPending(userId, entryId, choice === "cash" || choice === "cancel" ? choice : { account: Number(choice) })
    )
}

/* 確定済みのカード明細から、レシート・メールを付ける（Issue #912） */

function parseCandidateRef(ref: StatementCandidateRef): StatementCandidateRef {
    if ((ref?.type !== "receipt" && ref?.type !== "pending") || !Number.isInteger(ref?.id)) throw new Error("候補の指定が正しくありません")
    return { type: ref.type, id: ref.id }
}

/** 取引の画面の「レシート・メールを付ける」。対象外のカード明細なら null。`wide` は「条件を広げて探す」 */
export async function getStatementCandidatesAction(entryId: number, wide: boolean): Promise<StatementCandidatesView | null> {
    const userId = await getCurrentUserId()
    if (!userId || !Number.isInteger(entryId)) return null
    return loadStatementCandidates(userId, entryId, wide === true)
}

/** 明細一覧の「レシート候補 N」。取引の id → 候補の件数（候補の無い取引は含まない） */
export async function getStatementCandidateCounts(entryIds: number[]): Promise<Record<number, number>> {
    const userId = await getCurrentUserId()
    if (!userId) return {}
    const ids = (Array.isArray(entryIds) ? entryIds : []).filter((id) => Number.isInteger(id))
    return Object.fromEntries(await countStatementCandidates(userId, ids))
}

/** 確認待ちの「レシートを付けられそうなカード明細」 */
export async function getStatementSuggestions(): Promise<StatementCandidatesView[] | null> {
    const userId = await getCurrentUserId()
    if (!userId) return null
    return loadStatementSuggestions(userId)
}

export async function attachToStatementAction(entryId: number, ref: StatementCandidateRef, attach?: AttachRequest): Promise<LedgerActionResult> {
    return run("attachToStatement", async (userId) => {
        await attachToStatement(userId, entryId, parseCandidateRef(ref), parseAttachRequest(attach))
        revalidatePath("/receipts", "layout")
    })
}

export async function rejectStatementCandidateAction(entryId: number, ref: StatementCandidateRef): Promise<LedgerActionResult> {
    return run("rejectStatementCandidate", (userId) => rejectStatementCandidate(userId, entryId, parseCandidateRef(ref)))
}

/* 取引にサブスクを紐付ける（Issue #946）。印を付けるだけで、取引の金額・日付・品目は変えない */

function parseSubscriptionId(id: number): number {
    if (!Number.isInteger(id)) throw new Error("定期払いの指定が正しくありません")
    return id
}

/** 取引の画面の「この支払いに紐付ける」に出すサブスクの候補・紐付け済み。対象外の取引なら null */
export async function getSubscriptionLinkStateAction(entryId: number, wide: boolean): Promise<LedgerSubscriptionState | null> {
    const userId = await getCurrentUserId()
    if (!userId || !Number.isInteger(entryId)) return null
    return loadSubscriptionLinkState(userId, entryId, wide === true)
}

/** 紐付ける前の変更プレビュー（Issue #957）。何も書き換えない */
export async function getSubscriptionAttachPreviewAction(
    entryId: number,
    subscriptionId: number
): Promise<{ success: true; data: SubscriptionAttachPreviewView } | { success: false; error: string }> {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }
        if (!Number.isInteger(entryId) || !Number.isInteger(subscriptionId)) return { success: false, error: "指定が正しくありません" }
        return { success: true, data: await loadSubscriptionAttachPreview(userId, entryId, subscriptionId) }
    } catch (error) {
        console.error("[ledger:subscriptionAttachPreview]", error)
        return { success: false, error: error instanceof Error ? error.message : "変更内容を読めませんでした" }
    }
}

/** `request` は項目ごとの「変更する」と、プレビューを開いた時点の取引の更新時刻（無ければ既定に従う） */
export async function linkSubscriptionAction(
    entryId: number,
    subscriptionId: number,
    request?: { select?: Partial<SubscriptionAttachSelection>; expectedUpdatedAt?: string }
): Promise<LedgerActionResult> {
    const expected =
        typeof request?.expectedUpdatedAt === "string" && Number.isFinite(new Date(request.expectedUpdatedAt).getTime()) ? request.expectedUpdatedAt : undefined
    return run("linkSubscription", (userId) =>
        linkSubscriptionToEntry(userId, entryId, parseSubscriptionId(subscriptionId), {
            select: parseSubscriptionSelection(request?.select),
            ...(expected ? { expectedUpdatedAt: expected } : {}),
        })
    )
}

export async function unlinkSubscriptionAction(entryId: number): Promise<LedgerActionResult> {
    return run("unlinkSubscription", (userId) => unlinkSubscriptionFromEntry(userId, entryId))
}

export async function rejectSubscriptionCandidateAction(entryId: number, subscriptionId: number): Promise<LedgerActionResult> {
    return run("rejectSubscriptionCandidate", (userId) => rejectSubscriptionCandidate(userId, entryId, parseSubscriptionId(subscriptionId)))
}

/* Zaim CSVからの移行（Issue #820） */

async function readCsvFile(formData: FormData): Promise<{ bytes: Uint8Array; fileName: string }> {
    const file = formData.get("file")
    if (!(file instanceof File) || file.size === 0) throw new Error("CSVファイルを選んでください")
    if (file.size > 7 * 1024 * 1024) throw new Error("ファイルが大きすぎます（7MBまで）。期間を分けて書き出してください")
    return { bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name }
}

export async function previewZaimCsvAction(
    formData: FormData
): Promise<{ success: true; data: CsvPreview } | { success: false; error: string }> {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }
        const { bytes, fileName } = await readCsvFile(formData)
        return { success: true, data: await previewZaimCsv(userId, bytes, fileName) }
    } catch (error) {
        console.error("[ledger:previewCsv]", error)
        return { success: false, error: error instanceof Error ? error.message : "CSVを読めませんでした" }
    }
}

export async function importZaimCsvAction(
    formData: FormData
): Promise<{ success: true; data: CsvImportResult } | { success: false; error: string }> {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }
        const { bytes, fileName } = await readCsvFile(formData)
        const data = await importZaimCsv(userId, bytes, fileName)
        revalidatePath(LEDGER_PATH)
        return { success: true, data }
    } catch (error) {
        console.error("[ledger:importCsv]", error)
        return { success: false, error: error instanceof Error ? error.message : "取り込みに失敗しました" }
    }
}

export async function getImportBatches(): Promise<ImportBatchView[]> {
    const userId = await getCurrentUserId()
    if (!userId) return []
    return listImportBatches(userId)
}

export async function undoImportBatchAction(batchId: number): Promise<LedgerActionResult> {
    return run("undoImportBatch", async (userId) => {
        await undoImportBatch(userId, batchId)
    })
}

/** 取り込み済みの、同額で増減が逆の残高調整の組（差し引きゼロ）の候補（#1028） */
export async function getOffsettingAdjustmentCandidatesAction(): Promise<
    { success: true; data: OffsettingAdjustmentCandidate[] } | { success: false; error: string }
> {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }
        return { success: true, data: await findOffsettingAdjustmentCandidates(userId) }
    } catch (error) {
        console.error("[ledger:offsettingAdjustments]", error)
        return { success: false, error: "候補を探せませんでした" }
    }
}

export async function deleteOffsettingAdjustmentPairsAction(
    decreaseIds: number[]
): Promise<{ success: true; deleted: number } | { success: false; error: string }> {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }
        const ids = parseIdList(decreaseIds)
        const deleted = await deleteOffsettingAdjustmentPairs(userId, ids)
        revalidatePath(LEDGER_PATH, "layout")
        return { success: true, deleted }
    } catch (error) {
        console.error("[ledger:deleteOffsettingAdjustments]", error)
        return { success: false, error: error instanceof Error ? error.message : "削除に失敗しました" }
    }
}
