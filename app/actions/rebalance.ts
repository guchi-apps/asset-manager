"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { getCurrentUserId } from "@/lib/auth"
import { getFinancialSnapshot } from "@/lib/user-financial-snapshot"
import { getTagGroups } from "@/app/actions/tags"
import { getAnthropicApiKey } from "@/lib/anthropic-messages"
import { loadInvestmentProfile, loadMonthlyDeposit } from "@/lib/investment-profile"
import { EMPTY_INVESTMENT_PROFILE, getAdviceModel } from "@/lib/rebalance-advice"
import type { AllocationTargetRecord, RebalanceAxis, RebalanceCategory, RebalanceTagGroup } from "@/lib/rebalance"
import {
    categoryTargetsOf,
    checkTagAxisCompatibility,
    deriveTagTargets,
    findTagMismatches,
    hasCategoryTargets,
    rescaleCategoryTargets,
    RATIO_TOLERANCE,
} from "@/lib/rebalance-consistency"

/** 目標比率の合計として許容する誤差（%） */
const TARGET_SUM_TOLERANCE = RATIO_TOLERANCE

export interface SaveTargetItem {
    /** カテゴリ軸ならカテゴリID、タグ軸ならタグ選択肢ID。タグ軸の「未分類」だけ null */
    id: number | null
    ratio: number
    /** リバランスの計算から外す指定。true の行は ratio を使わず、合計100%にも数えない */
    excluded?: boolean
}

export interface SaveTargetOptions {
    /**
     * カテゴリ軸の保存で、タグ軸に保存済みの目標と一致しなくても保存する（#405）。
     * カテゴリ別の目標を保存するとタグ軸の目標はカテゴリ別から算出した値になるため、
     * 一致しない場合は画面で断ってからこのフラグを立てる
     */
    replaceTagTargets?: boolean
}

export async function getRebalanceData() {
    const userId = await getCurrentUserId()

    const [{ categories }, tagGroups] = await Promise.all([
        getFinancialSnapshot(),
        getTagGroups(),
    ])

    const [targets, profile, monthlyDeposit] = userId
        ? await Promise.all([
              loadTargets(userId),
              loadInvestmentProfile(userId),
              loadMonthlyDeposit(userId),
          ])
        : [[], EMPTY_INVESTMENT_PROFILE, null]

    return {
        categories,
        tagGroups,
        targets,
        // AI助言（Issue #397）。キーが無い環境ではカードのボタンを押せなくする
        aiAvailable: Boolean(getAnthropicApiKey()),
        adviceModel: getAdviceModel(),
        profile,
        monthlyDeposit,
    }
}

async function loadTargets(userId: string): Promise<AllocationTargetRecord[]> {
    try {
        const rows = await prisma.allocationTarget.findMany({
            where: { userId },
            select: {
                categoryId: true,
                tagGroupId: true,
                tagOptionId: true,
                ratio: true,
                excluded: true,
            },
        })
        return rows
    } catch (error) {
        console.error("Failed to fetch allocation targets:", error)
        return []
    }
}

type SaveResult = { success: true } | { success: false; error: string }

function validateItems(items: SaveTargetItem[]): SaveResult | null {
    const targetItems = items.filter((item) => !item.excluded)
    for (const item of targetItems) {
        if (!Number.isFinite(item.ratio) || item.ratio < 0 || item.ratio > 100) {
            return { success: false, error: "目標は0〜100%の範囲で入力してください" }
        }
        if (item.id == null) {
            return { success: false, error: "目標を設定できない項目です" }
        }
    }
    return null
}

function sumOf(items: SaveTargetItem[]): number {
    return items.filter((item) => !item.excluded).reduce((acc, item) => acc + item.ratio, 0)
}

type TargetRowInput = {
    userId: string
    ratio: number
    excluded: boolean
    categoryId: number | null
    tagGroupId: number | null
    tagOptionId: number | null
}

/**
 * 指定した軸の目標配分と、計算から外す指定をまとめて置き換える。
 * 空の配列を渡すと、その軸の目標も除外指定もすべて削除する。
 *
 * 軸をまたぐ整合（#405）:
 * - カテゴリ軸の保存は、タグ軸に保存されていた目標・除外をすべて消す（以後はカテゴリ別から算出する）。
 *   タグ軸の目標と一致しない内容は `replaceTagTargets` が無ければ拒む
 * - カテゴリ別の目標があるときのタグ軸の保存は、指定した比率へカテゴリ別の目標を比例配分で調整する
 * - カテゴリ別の目標が無いときのタグ軸の保存は、他のタグ軸の目標と両立する場合だけ受け付ける
 */
export async function saveAllocationTargets(
    axis: RebalanceAxis,
    items: SaveTargetItem[],
    options: SaveTargetOptions = {},
): Promise<SaveResult> {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }

        const invalid = validateItems(items)
        if (invalid) return invalid

        const [{ categories }, tagGroups, stored] = await Promise.all([
            getFinancialSnapshot(),
            getTagGroups(),
            loadTargets(userId),
        ])

        const plan = axis.kind === "category"
            ? planCategorySave({ userId, items, categories, tagGroups, stored, options })
            : hasCategoryTargets(stored)
                ? planDerivedTagSave({ userId, axis, items, categories, stored })
                : planTagSave({ userId, axis, items, categories, tagGroups, stored })
        if ("error" in plan) return { success: false, error: plan.error }

        await prisma.$transaction(async (tx) => {
            await tx.allocationTarget.deleteMany({ where: { userId, ...plan.where } })
            if (plan.rows.length) await tx.allocationTarget.createMany({ data: plan.rows })
        })

        revalidatePath("/rebalance")
        return { success: true }
    } catch (error) {
        console.error("Failed to save allocation targets:", error)
        return { success: false, error: "目標配分の保存に失敗しました" }
    }
}

type SavePlan =
    | { where: Record<string, unknown>; rows: TargetRowInput[] }
    | { error: string }

/** カテゴリ軸の保存。タグ軸の行はすべて消し、以後はカテゴリ別から算出する */
function planCategorySave(params: {
    userId: string
    items: SaveTargetItem[]
    categories: RebalanceCategory[]
    tagGroups: RebalanceTagGroup[]
    stored: AllocationTargetRecord[]
    options: SaveTargetOptions
}): SavePlan {
    const { userId, items, categories, tagGroups, stored, options } = params
    const targetItems = items.filter((item) => !item.excluded)
    // id が無いのはタグ軸の「未分類」だけ。カテゴリ軸には該当する項目が無い
    if (items.some((item) => item.excluded && item.id == null)) {
        return { error: "対象外にできない項目です" }
    }
    if (targetItems.length && Math.abs(sumOf(items) - 100) > TARGET_SUM_TOLERANCE) {
        return { error: "目標の合計を100%にしてください" }
    }

    if (targetItems.length && !options.replaceTagTargets) {
        const entered = categoryTargetsOf(
            items.map((item) => ({
                categoryId: item.id,
                tagGroupId: null,
                tagOptionId: null,
                ratio: item.ratio,
                excluded: item.excluded === true,
            })),
        )
        const mismatches = findTagMismatches({ categories, tagGroups, targets: stored, categoryTargets: entered })
        if (mismatches.length) {
            const groups = [...new Set(mismatches.map((m) => m.groupName))].join("・")
            return { error: `${groups}の目標と一致していません。合わせるか、置き換えて保存してください` }
        }
    }

    return {
        // 比率を保存するときだけタグ軸の行も消す（除外だけ・全削除のときは、タグ軸の目標を独立のまま残す）
        where: targetItems.length ? {} : { categoryId: { not: null } },
        rows: items.map((item) => ({
            userId,
            ratio: item.excluded ? 0 : item.ratio,
            excluded: item.excluded === true,
            categoryId: item.id,
            tagGroupId: null,
            tagOptionId: null,
        })),
    }
}

/** カテゴリ別の目標があるタグ軸の保存。カテゴリ別の目標を指定した比率へ寄せる */
function planDerivedTagSave(params: {
    userId: string
    axis: Extract<RebalanceAxis, { kind: "tagGroup" }>
    items: SaveTargetItem[]
    categories: RebalanceCategory[]
    stored: AllocationTargetRecord[]
}): SavePlan {
    const { userId, axis, items, categories, stored } = params
    if (items.some((item) => item.excluded)) {
        return { error: "カテゴリ別の目標があるときは、除外はカテゴリ別で設定してください" }
    }
    const categoryTargets = categoryTargetsOf(stored)
    const derivedUnassigned = deriveTagTargets(categories, categoryTargets, axis.tagGroupId)
        .find((d) => d.key === null)
    const fixed = derivedUnassigned && !derivedUnassigned.excluded ? derivedUnassigned.ratio : 0
    if (Math.abs(sumOf(items) + fixed - 100) > TARGET_SUM_TOLERANCE) {
        return { error: "目標の合計を100%にしてください" }
    }

    const ratios = new Map<number, number>()
    for (const item of items) if (item.id != null) ratios.set(item.id, item.ratio)
    const rescaled = rescaleCategoryTargets({ categories, targets: stored, tagGroupId: axis.tagGroupId, ratios })
    if (!rescaled) {
        return { error: "この比率に合わせられるカテゴリ別の目標がありません。カテゴリ別で設定してください" }
    }

    const rows: TargetRowInput[] = rescaled.map((r) => ({
        userId,
        ratio: r.ratio,
        excluded: false,
        categoryId: r.categoryId,
        tagGroupId: null,
        tagOptionId: null,
    }))
    for (const [categoryId, t] of categoryTargets) {
        if (!t.excluded) continue
        rows.push({ userId, ratio: 0, excluded: true, categoryId, tagGroupId: null, tagOptionId: null })
    }
    // タグ軸に残っていた古い行も一緒に消す（算出値に置き換わっているため）
    return { where: {}, rows }
}

/** カテゴリ別の目標が無いタグ軸の保存。他のタグ軸の目標と両立する場合だけ受け付ける */
function planTagSave(params: {
    userId: string
    axis: Extract<RebalanceAxis, { kind: "tagGroup" }>
    items: SaveTargetItem[]
    categories: RebalanceCategory[]
    tagGroups: RebalanceTagGroup[]
    stored: AllocationTargetRecord[]
}): SavePlan {
    const { userId, axis, items, categories, tagGroups, stored } = params
    const targetItems = items.filter((item) => !item.excluded)
    if (targetItems.length && Math.abs(sumOf(items) - 100) > TARGET_SUM_TOLERANCE) {
        return { error: "目標の合計を100%にしてください" }
    }

    if (targetItems.length) {
        const result = checkTagAxisCompatibility({
            categories,
            tagGroups,
            targets: stored,
            input: {
                tagGroupId: axis.tagGroupId,
                items: items.map((item) => ({ key: item.id, ratio: item.ratio, excluded: item.excluded === true })),
            },
        })
        if (!result.compatible) {
            const names = result.conflictingGroups.length
                ? result.conflictingGroups.map((n) => `「${n}」`).join("・")
                : "他のタグ軸"
            return { error: `${names}の目標と同時には満たせません。どちらかを見直してください` }
        }
    }

    return {
        where: { tagGroupId: axis.tagGroupId },
        rows: items.map((item) => ({
            userId,
            ratio: item.excluded ? 0 : item.ratio,
            excluded: item.excluded === true,
            categoryId: null,
            tagGroupId: axis.tagGroupId,
            tagOptionId: item.id,
        })),
    }
}
