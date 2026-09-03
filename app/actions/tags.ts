"use server"

import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { getCurrentUserId } from "@/lib/auth"
import { revalidateUserDashboard } from "@/lib/dashboard-cache"

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

// --- Tag Groups (New Schema) ---

export async function getTagGroups() {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return [];
        const groups = await prisma.tagGroup.findMany({
            where: { userId },
            include: {
                options: {
                    orderBy: { order: 'asc' }
                }
            },
            orderBy: { order: 'asc' }
        });

        return groups.map((g) => ({
            id: g.id,
            name: g.name,
            order: g.order,
            options: g.options.map((o) => ({
                id: o.id,
                name: o.name,
                order: o.order
            }))
        }));
    } catch (error) {
        console.error("Failed to fetch tag groups:", error);
        return [];
    }
}

export async function saveTagGroup(data: { id?: number, name: string, options: { id?: number, name: string }[] }) {
    // Input Validation
    if (data.name && data.name.length > 50) {
        return { success: false, error: "タググループ名は50文字以内で入力してください" }
    }
    if (data.options && data.options.some(o => o.name && o.name.length > 50)) {
        return { success: false, error: "タグ名称は50文字以内で入力してください" }
    }

    try {
        const userId = await getCurrentUserId()
        if (!userId) {
            return { success: false, error: "ログインが必要です" }
        }

        let savedGroup;
        if (data.id) {
            const owned = await prisma.tagGroup.findFirst({ where: { id: data.id, userId }, select: { id: true } })
            if (!owned) {
                return { success: false, error: "タググループが見つかりません" }
            }

            savedGroup = await prisma.$transaction(async (tx) => {
                await tx.tagGroup.updateMany({
                    where: { id: data.id!, userId },
                    data: { name: data.name }
                })

                // 2. Handle Options
                const incomingOptions = data.options || []
                const incomingIds = incomingOptions.filter(o => o.id).map(o => o.id)

                // Delete removed options
                await tx.categoryTag.deleteMany({
                    where: {
                        tagGroupId: data.id!,
                        tagOptionId: { notIn: incomingIds as number[] }
                    }
                })
                await tx.tagOption.deleteMany({
                    where: {
                        tagGroupId: data.id!,
                        id: { notIn: incomingIds as number[] }
                    }
                })
                // 外部キー制約が無いため、消えた選択肢の目標配分も明示的に消す
                await tx.allocationTarget.deleteMany({
                    where: {
                        tagGroupId: data.id!,
                        tagOptionId: { notIn: incomingIds as number[] }
                    }
                })

                // Update existing or Create new
                for (let i = 0; i < incomingOptions.length; i++) {
                    const opt = incomingOptions[i];
                    if (opt.id) {
                        await tx.tagOption.update({
                            where: { id: opt.id },
                            data: { name: opt.name, order: i }
                        })
                    } else {
                        await tx.tagOption.create({
                            data: {
                                tagGroupId: data.id!,
                                name: opt.name,
                                order: i
                            }
                        })
                    }
                }

                return await tx.tagGroup.findUnique({
                    where: { id: data.id },
                    include: { options: { orderBy: { order: 'asc' } } }
                })
            })
        } else {
            // Create New Group
            const maxOrderVal = await prisma.tagGroup.aggregate({
                where: { userId },
                _max: { order: true }
            })
            const nextOrder = (maxOrderVal._max?.order ?? -1) + 1

            savedGroup = await prisma.tagGroup.create({
                data: {
                    name: data.name,
                    userId,
                    order: nextOrder,
                    options: {
                        create: (data.options || []).map((opt, idx) => ({
                            name: opt.name,
                            order: idx
                        }))
                    }
                },
                include: {
                    options: { orderBy: { order: 'asc' } }
                }
            })
        }
        revalidatePath("/assets")
        revalidatePath("/")
        invalidateDashboard(userId)
        return { success: true, group: savedGroup }
    } catch (error) {
        console.error("Failed to save tag group:", error)
        try {
            // Fallback error logging to stringify if it's an object
            console.error(JSON.stringify(error, null, 2))
        } catch { }
        return { success: false, error }
    }
}

export async function deleteTagGroup(id: number) {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }

        const owned = await prisma.tagGroup.findFirst({ where: { id, userId }, select: { id: true } })
        if (!owned) return { success: false, error: "タググループが見つかりません" }

        // 外部キー制約が無いため、目標配分は明示的に消す
        await prisma.allocationTarget.deleteMany({ where: { tagGroupId: id, userId } })
        await prisma.tagGroup.deleteMany({ where: { id, userId } })
        revalidatePath("/assets")
        invalidateDashboard(userId)
        return { success: true }
    } catch (error) {
        console.error("Failed to delete tag group:", error)
        return { success: false }
    }
}

export async function reorderTagGroupsAction(items: { id: number, order: number }[]) {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }

        const ids = items.map((item) => item.id)
        const owned = await prisma.tagGroup.findMany({ where: { id: { in: ids }, userId }, select: { id: true } })
        if (owned.length !== ids.length) return { success: false, error: "タググループが見つかりません" }

        await prisma.$transaction(
            items.map(item =>
                prisma.tagGroup.update({
                    where: { id: item.id },
                    data: { order: item.order }
                })
            )
        );
        revalidatePath("/assets");
        invalidateDashboard(userId);
        return { success: true };
    } catch (error) {
        console.error("Failed to reorder tag groups", error)
        return { success: false }
    }
}

export async function renameTagGroup(id: number, name: string) {
    // Input Validation
    if (name && name.length > 50) {
        return { success: false, error: "タググループ名は50文字以内で入力してください" }
    }

    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }

        const result = await prisma.tagGroup.updateMany({
            where: { id, userId },
            data: { name }
        })
        if (result.count === 0) return { success: false, error: "タググループが見つかりません" }

        revalidatePath("/assets")
        revalidatePath("/")
        invalidateDashboard(userId)
        return { success: true }
    } catch (error) {
        console.error("Failed to rename tag group:", error)
        return { success: false, error }
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

        const group = await prisma.tagGroup.findFirst({ where: { id: groupId, userId }, select: { id: true } })
        if (!group) return { success: false, error: "タググループが見つかりません" }

        const categoryIds = Array.from(new Set(mappings.map((m) => m.categoryId)))
        const ownedCategories = await prisma.category.findMany({ where: { id: { in: categoryIds }, userId }, select: { id: true } })
        if (ownedCategories.length !== categoryIds.length) return { success: false, error: "カテゴリが見つかりません" }

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
