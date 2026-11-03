"use server"

/**
 * 家計簿画面のサーバーアクション（Issue #815）。
 *
 * 読み書きの中身は `lib/ledger-service.ts`、入力の検証は `lib/ledger-input.ts` にあり、ここは認証と再検証だけを担う。
 */

import { revalidatePath } from "next/cache"

import { getCurrentUser, getCurrentUserId } from "@/lib/auth"
import { isZaimAllowedEmail } from "@/lib/zaim-access"
import { syncZaimLedger } from "@/lib/ledger-sources/zaim/fetch"
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
    deleteAccount,
    deleteCategory,
    deleteEntry,
    loadLedgerPage,
    mergeCategory,
    moveCategory,
    setAccountBalance,
    setAccountHidden,
    setCategoryHidden,
    setPeriodMode,
    suggestOpeningBalance,
    updateAccount,
    updateCategory,
    updateEntry,
    type LedgerPageData,
    type OpeningBalanceSuggestion,
} from "@/lib/ledger-service"
import {
    isValidIsoDate,
    parseAccountInput,
    parseCategoryInput,
    parseEntryInput,
    parseYen,
    type AccountInput,
    type CategoryInput,
    type EntryInput,
} from "@/lib/ledger-input"
import { normalizePeriodMode } from "@/lib/ledger-period"
import { loadHouseholdAnalysis, type HouseholdAnalysis } from "@/lib/ledger-analysis-service"
import {
    applySourceMappings,
    createAccountsForUnmapped,
    loadMappingOverview,
    setAccountMapping,
    setCategoryMapping,
    type MappingOverview,
} from "@/lib/ledger-sources/mapping-service"

export type LedgerActionResult = { success: true } | { success: false; error: string }

const LEDGER_PATH = "/ledger"

async function run(label: string, fn: (userId: string) => Promise<void>): Promise<LedgerActionResult> {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }
        await fn(userId)
        revalidatePath(LEDGER_PATH)
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

/* 取引 */

export async function createEntryAction(input: EntryInput): Promise<LedgerActionResult> {
    return run("createEntry", async (userId) => {
        await createEntry(userId, unwrap(parseEntryInput(input)))
    })
}

export async function updateEntryAction(id: number, input: EntryInput): Promise<LedgerActionResult> {
    return run("updateEntry", (userId) => updateEntry(userId, id, unwrap(parseEntryInput(input))))
}

export async function deleteEntryAction(id: number): Promise<LedgerActionResult> {
    return run("deleteEntry", (userId) => deleteEntry(userId, id))
}

export async function setPeriodModeAction(mode: string): Promise<LedgerActionResult> {
    return run("setPeriodMode", (userId) => setPeriodMode(userId, normalizePeriodMode(mode)))
}

/* 口座 */

export async function createAccountAction(input: AccountInput): Promise<LedgerActionResult> {
    return run("createAccount", (userId) => createAccount(userId, unwrap(parseAccountInput(input))))
}

export async function updateAccountAction(id: number, input: AccountInput): Promise<LedgerActionResult> {
    return run("updateAccount", (userId) => updateAccount(userId, id, unwrap(parseAccountInput(input))))
}

export async function setAccountHiddenAction(id: number, hidden: boolean): Promise<LedgerActionResult> {
    return run("setAccountHidden", (userId) => setAccountHidden(userId, id, hidden))
}

export async function deleteAccountAction(id: number): Promise<LedgerActionResult> {
    return run("deleteAccount", (userId) => deleteAccount(userId, id))
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

export async function suggestOpeningBalanceAction(
    assetCategoryId: number,
    openingDate: string
): Promise<OpeningBalanceSuggestion | null> {
    const userId = await getCurrentUserId()
    if (!userId || !isValidIsoDate(openingDate) || !Number.isInteger(assetCategoryId)) return null
    return suggestOpeningBalance(userId, assetCategoryId, openingDate)
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

export async function moveCategoryAction(id: number, direction: "up" | "down"): Promise<LedgerActionResult> {
    return run("moveCategory", (userId) => moveCategory(userId, id, direction === "up" ? "up" : "down"))
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

/* Zaim明細の取り込み（Issue #817） */

export async function getLedgerSyncStatus(): Promise<LedgerSyncStatusView | null> {
    const userId = await getCurrentUserId()
    if (!userId) return null
    return loadLedgerSyncStatus(userId)
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
        return { success: true, message: result.message }
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

export async function getHouseholdAnalysis(offset = 0): Promise<HouseholdAnalysis | null> {
    const userId = await getCurrentUserId()
    if (!userId) return null
    return loadHouseholdAnalysis(userId, offset)
}
