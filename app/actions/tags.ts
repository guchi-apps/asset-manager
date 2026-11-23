"use server"

import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { getCurrentUserId } from "@/lib/auth"
import { revalidateUserDashboard } from "@/lib/dashboard-cache"
import { arrangeFixedTagGroups, missingFixedTagGroups } from "@/lib/fixed-tag-groups"

function invalidateDashboard(userId: string | null | undefined) {
    if (userId) revalidateUserDashboard(userId)
}

// --- Tags Legacy (Deprecated) ---
// These are kept empty or simple to prevent build errors until fully removed

export async function getTags() {
    return []
}

export async function saveTag() {
    return { success: false, error: "Deprecated" }
}

export async function deleteTag() {
    return { success: false, error: "Deprecated" }
}

// --- Tag Groups ---
// 分類の種類はコードで固定（`lib/fixed-tag-groups.ts`。#1617）。追加・削除・改名・並び替えの口は持たない。

/** 固定の分類がまだ無ければ作る。並行して呼ばれても `@@unique([userId, key])` と skipDuplicates で重複しない */
async function ensureFixedTagGroups(userId: string) {
    const existing = await prisma.tagGroup.findMany({ where: { userId, key: { not: null } }, select: { key: true } })
    const missing = missingFixedTagGroups(existing.map((g) => g.key))
    if (missing.length === 0) return
    await prisma.tagGroup.createMany({
        data: missing.map((g) => ({ userId, key: g.key, name: g.name, order: g.order })),
        skipDuplicates: true,
    })
}

export async function getTagGroups() {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return [];
        await ensureFixedTagGroups(userId)
        const groups = await prisma.tagGroup.findMany({
            where: { userId, key: { not: null } },
            include: {
                options: {
                    orderBy: { order: 'asc' }
                },
                assetTags: { select: { tagOptionId: true } },
            },
        });

        return arrangeFixedTagGroups(groups).map((g) => {
            const counts = new Map<number, number>()
            for (const t of g.assetTags) counts.set(t.tagOptionId, (counts.get(t.tagOptionId) ?? 0) + 1)
            return {
                id: g.id,
                key: g.key,
                name: g.name,
                description: g.description,
                order: g.order,
                options: g.options.map((o) => ({
                    id: o.id,
                    name: o.name,
                    order: o.order,
                    assetCount: counts.get(o.id) ?? 0,
                })),
                assignedCount: g.assetTags.length,
            }
        });
    } catch (error) {
        console.error("Failed to fetch tag groups:", error);
        return [];
    }
}

/** 固定の分類の選択肢を保存する（並び順は渡した順）。分類そのものの名前は変えない */
export async function saveTagOptions(data: { groupId: number, options: { id?: number, name: string }[] }) {
    const options = (data.options || []).map((o) => ({ ...o, name: o.name.trim() }))
    if (options.some((o) => !o.name)) {
        return { success: false, error: "選択肢の名前を入力してください" }
    }
    if (options.some((o) => o.name.length > 50)) {
        return { success: false, error: "選択肢の名前は50文字以内で入力してください" }
    }
    // 履歴の系列キーが選択肢の名前（`tag_<groupId>_<name>`）なので、同じ分類の中で名前を重ねない
    if (new Set(options.map((o) => o.name)).size !== options.length) {
        return { success: false, error: "同じ名前の選択肢があります" }
    }

    try {
        const userId = await getCurrentUserId()
        if (!userId) {
            return { success: false, error: "ログインが必要です" }
        }

        const groupId = data.groupId
        const owned = await prisma.tagGroup.findFirst({ where: { id: groupId, userId, key: { not: null } }, select: { id: true } })
        if (!owned) {
            return { success: false, error: "分類が見つかりません" }
        }

        await prisma.$transaction(async (tx) => {
            const incomingIds = options.filter((o) => o.id).map((o) => o.id as number)

            // 消した選択肢の割り当て・選択肢・目標配分を消す（目標配分は外部キーが無いため明示的に消す）
            await tx.categoryTag.deleteMany({
                where: { tagGroupId: groupId, tagOptionId: { notIn: incomingIds } }
            })
            await tx.tagOption.deleteMany({
                where: { tagGroupId: groupId, id: { notIn: incomingIds } }
            })
            await tx.allocationTarget.deleteMany({
                where: { tagGroupId: groupId, tagOptionId: { notIn: incomingIds } }
            })

            for (let i = 0; i < options.length; i++) {
                const opt = options[i];
                if (opt.id) {
                    // 別の分類の選択肢を書き換えないよう、分類でも絞る
                    await tx.tagOption.updateMany({
                        where: { id: opt.id, tagGroupId: groupId },
                        data: { name: opt.name, order: i }
                    })
                } else {
                    await tx.tagOption.create({
                        data: { tagGroupId: groupId, name: opt.name, order: i }
                    })
                }
            }
        })
        revalidatePath("/assets")
        revalidatePath("/")
        invalidateDashboard(userId)
        return { success: true }
    } catch (error) {
        console.error("Failed to save tag options:", error)
        return { success: false, error: "選択肢の保存に失敗しました" }
    }
}

export async function getAssetsForTagGroup(groupId: number) {
    try {
        const userId = await getCurrentUserId()
        if (!userId) {
            throw new Error("User not authenticated")
        }
        // 1. Fetch all raw
        const categories = await prisma.category.findMany({
            where: { userId: userId! },
            select: { id: true, name: true, parentId: true, color: true, order: true }
        })

        // 2. Sort Hierarchically to match Main List
        const roots = categories
            .filter((c) => !c.parentId)
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

        const childrenMap = new Map<number, (typeof categories[0])[]>();
        categories.forEach((c) => {
            if (c.parentId) {
                const existing = childrenMap.get(c.parentId) || [];
                existing.push(c);
                childrenMap.set(c.parentId, existing);
            }
        });

        const sorted: (typeof categories[0])[] = [];
        roots.forEach((root) => {
            sorted.push(root);
            const children = (childrenMap.get(root.id) || []).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
            sorted.push(...children);
        });

        const existingTags = await prisma.categoryTag.findMany({
            where: { tagGroupId: groupId }
        })

        return sorted.map((cat) => {
            const tag = existingTags.find((t) => t.categoryId === cat.id)
            return {
                id: cat.id,
                name: cat.name,
                color: cat.color,
                parentId: cat.parentId,
                currentOptionId: tag?.tagOptionId || null
            }
        })
    } catch (e) {
        console.error(e)
        return []
    }
}

export async function updateAssetTagMappings(groupId: number, mappings: { categoryId: number, optionId: number | null }[]) {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }

        const group = await prisma.tagGroup.findFirst({ where: { id: groupId, userId, key: { not: null } }, select: { id: true } })
        if (!group) return { success: false, error: "分類が見つかりません" }

        const categoryIds = Array.from(new Set(mappings.map((m) => m.categoryId)))
        const ownedCategories = await prisma.category.findMany({ where: { id: { in: categoryIds }, userId }, select: { id: true } })
        if (ownedCategories.length !== categoryIds.length) return { success: false, error: "カテゴリが見つかりません" }
        const optionIds = Array.from(new Set(mappings.flatMap((m) => (m.optionId === null ? [] : [m.optionId]))))
        const groupOptions = await prisma.tagOption.count({ where: { id: { in: optionIds }, tagGroupId: groupId } })
        if (groupOptions !== optionIds.length) return { success: false, error: "選択肢が見つかりません" }

        await prisma.$transaction(async (tx) => {
            for (const m of mappings) {
                if (m.optionId === null) {
                    await tx.categoryTag.deleteMany({
                        where: { categoryId: m.categoryId, tagGroupId: groupId }
                    })
                } else {
                    await tx.categoryTag.upsert({
                        where: {
                            categoryId_tagGroupId: {
                                categoryId: m.categoryId,
                                tagGroupId: groupId
                            }
                        },
                        create: {
                            categoryId: m.categoryId,
                            tagGroupId: groupId,
                            tagOptionId: m.optionId
                        },
                        update: {
                            tagOptionId: m.optionId
                        }
                    })
                }
            }
        })
        revalidatePath("/assets")
        revalidatePath("/")
        invalidateDashboard(userId)
        return { success: true }
    } catch (e) {
        console.error("Failed to update mappings:", e)
        return { success: false, error: e }
    }
}
