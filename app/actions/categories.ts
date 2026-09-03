/* eslint-disable @typescript-eslint/no-explicit-any */
"use server"

import { cache } from "react"
import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { getCurrentUserId } from "@/lib/auth"
import { revalidateUserDashboard } from "@/lib/dashboard-cache"
import { getFinancialSnapshot } from "@/lib/user-financial-snapshot"
import { getCalendarDayKey } from "@/lib/valuation-day"

/**
 * Robustly fetch categories with fallback and type safety.
 */
export const getCategories = cache(async () => {
    const { categories } = await getFinancialSnapshot()
    return categories
})

function invalidateDashboard(userId: string | null | undefined) {
    if (userId) revalidateUserDashboard(userId)
}

interface SaveCategoryData {
    id?: number;
    name: string;
    color: string;
    order?: number;
    isCash: boolean;
    isLiability: boolean;
    parentId?: number;
    hidden?: boolean;
    tagSettings?: { groupId: number, optionId: number }[];
}

export async function saveCategory(data: SaveCategoryData) {
    // Input Validation
    if (data.name && data.name.length > 50) {
        return { success: false, error: "名称は50文字以内で入力してください" }
    }

    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }

        const baseData = {
            name: data.name,
            color: data.color,
            order: data.order ?? 0,
            isCash: !!data.isCash,
            isLiability: false,
            hidden: !!data.hidden,
            parentId: data.parentId === 0 ? null : (data.parentId || null),
        }

        let categoryId: number | undefined = data.id;

        if (categoryId) {
            // 所有確認を兼ねて、更新前に自分のカテゴリかを確かめる
            const existing = await prisma.category.findFirst({ where: { id: categoryId, userId }, select: { order: true } });
            if (!existing) return { success: false, error: "カテゴリが見つかりません" }
            await prisma.category.updateMany({
                where: { id: categoryId, userId },
                data: {
                    ...baseData,
                    order: data.order !== undefined ? data.order : (existing?.order ?? 0)
                }
            });
            await prisma.categoryTag.deleteMany({ where: { categoryId } });
        } else {
            const max = await prisma.category.aggregate({ where: { userId }, _max: { order: true } });
            const cat = await prisma.category.create({ data: { ...baseData, userId, order: (max._max.order ?? -1) + 1 } });
            categoryId = cat.id;
            await prisma.asset.create({ data: { categoryId: cat.id, userId, currentValue: 0 } });
        }

        if (data.tagSettings && data.tagSettings.length > 0 && categoryId) {
            await prisma.categoryTag.createMany({
                data: data.tagSettings.map((s) => ({
                    categoryId: categoryId as number,
                    tagGroupId: s.groupId,
                    tagOptionId: s.optionId
                }))
            });
        }

        revalidatePath("/");
        invalidateDashboard(userId);
        return { success: true };
    } catch (error) {
        console.error("Save error", error);
        return { success: false };
    }
}

export async function deleteCategory(id: number) {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }

        const owned = await prisma.category.findFirst({ where: { id, userId }, select: { id: true } });
        if (!owned) return { success: false, error: "カテゴリが見つかりません" }

        await prisma.category.updateMany({ where: { parentId: id, userId }, data: { parentId: null } });
        await prisma.asset.deleteMany({ where: { categoryId: id, userId } });
        await prisma.transaction.deleteMany({ where: { categoryId: id, userId } });
        // 外部キー制約が無いため、目標配分は明示的に消す
        await prisma.allocationTarget.deleteMany({ where: { categoryId: id, userId } });
        await prisma.category.deleteMany({ where: { id, userId } });
        revalidatePath("/");
        invalidateDashboard(userId);
        return { success: true };
    } catch (error) {
        console.error("Delete error", error);
        return { success: false };
    }
}

export async function updateCategoryOrder() {
    const userId = await getCurrentUserId()
    revalidatePath("/");
    invalidateDashboard(userId);
    return { success: true };
}

export async function reorderCategoriesAction(items: { id: number, order: number }[]) {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }

        const ids = items.map((item) => item.id)
        const owned = await prisma.category.findMany({ where: { id: { in: ids }, userId }, select: { id: true } })
        if (owned.length !== ids.length) return { success: false, error: "カテゴリが見つかりません" }

        await prisma.$transaction(
            items.map((item) =>
                prisma.category.update({
                    where: { id: item.id },
                    data: { order: item.order }
                })
            )
        );
        revalidatePath("/");
        invalidateDashboard(userId);
        return { success: true };
    } catch (error) {
        console.error("Reorder failed", error);
        return { success: false };
    }
}

interface TransactionDetail {
    amount: number;
    type: string;
    id: number;
    memo: string | null;
    transactedAt: Date;
    realizedGain: number | null;
}

interface AssetDetail {
    currentValue: number;
    recordedAt: Date;
    id: number;
}


export async function getCategoryDetails(id: number) {
    try {
        const userId = await getCurrentUserId();
        if (!userId) return null;

        const allCatsForUser = await prisma.category.findMany({
            where: { userId },
            include: {
                tags: { include: { tagGroup: true, tagOption: true } },
                assets: { orderBy: { recordedAt: 'asc' } },
                transactions: { orderBy: { transactedAt: 'asc' } },
                parent: true
            }
        });

        const cat = allCatsForUser.find(c => c.id === id);
        if (!cat) return null;

        // Recursive function to find all descendant categories
        const getDescendants = (parentId: number): any[] => {
            const children = allCatsForUser.filter(c => c.parentId === parentId);
            return [...children, ...children.flatMap(c => getDescendants(c.id))];
        };

        const allDescendants = getDescendants(id);
        const directChildren = allCatsForUser.filter(c => c.parentId === id);

        const catWithNested = {
            ...cat,
            // We'll use this for internal processing of ALL descendants
            allDescendants: allDescendants,
            // And this for direct children (list/dropdown)
            children: directChildren
        };

        // Helper to calc history for a single category node
        const calculateHistoryForCategory = (c: { transactions: TransactionDetail[], assets: AssetDetail[] }) => {
            const historyMap = new Map<string, { date: Date, value: number | null, cost: number, netFlow: number }>();
            let runningCost = 0;

            // 1. Transactions
            (c.transactions || []).forEach((t) => {
                const amt = Number(t.amount);
                let flow = 0;
                if (t.type === 'DEPOSIT') {
                    runningCost += amt;
                    flow = amt;
                }
                else if (t.type === 'WITHDRAW') {
                    runningCost -= amt;
                    flow = -amt;
                }

                const dateStr = getCalendarDayKey(t.transactedAt);
                if (historyMap.has(dateStr)) {
                    const exist = historyMap.get(dateStr)!;
                    exist.cost = runningCost; // Update to latest running cost of the day
                    exist.netFlow += flow;
                } else {
                    historyMap.set(dateStr, {
                        date: t.transactedAt,
                        value: null,
                        cost: runningCost,
                        netFlow: flow
                    });
                }
            });

            // 2. Assets
            (c.assets || []).forEach((a) => {
                const dateStr = getCalendarDayKey(a.recordedAt);
                const existing = historyMap.get(dateStr);

                if (existing) {
                    existing.value = a.currentValue;
                } else {
                    // Estimate cost at this point
                    const costAtTime = (c.transactions || [])
                        .filter((t) => t.transactedAt <= a.recordedAt)
                        .reduce((acc: number, t) => {
                            const amt = Number(t.amount);
                            if (t.type === 'DEPOSIT') return acc + amt;
                            if (t.type === 'WITHDRAW') return acc - amt;
                            return acc;
                        }, 0);

                    historyMap.set(dateStr, {
                        date: a.recordedAt,
                        value: a.currentValue,
                        cost: costAtTime,
                        netFlow: 0
                    });
                }
            });

            const sorted = Array.from(historyMap.values())
                .sort((a, b) => a.date.getTime() - b.date.getTime());

            // Fill gaps and create steps
            if (sorted.length === 0) return [];

            interface HistoryPoint {
                date: Date;
                value: number;
                cost: number;
                netFlow: number;
            }

            const processed: HistoryPoint[] = [];

            // Add initial point if needed or just handle logic in loop
            processed.push({ ...sorted[0], value: sorted[0].value || 0 });

            for (let i = 1; i < sorted.length; i++) {
                const prev = processed[processed.length - 1]; // Use last processed point (which has filled value)
                const curr = sorted[i];

                // Calculate day difference
                const dayDiff = Math.floor((curr.date.getTime() - prev.date.getTime()) / (1000 * 60 * 60 * 24));

                // If gap > 1 day, insert a "day before" point to create step effect
                if (dayDiff > 1) {
                    const dayBeforeVar = new Date(curr.date);
                    dayBeforeVar.setDate(curr.date.getDate() - 1);

                    // COST: Use PREVIOUS cost (to keep it flat until the day before change)
                    const fillCost = prev.cost;

                    // VALUE: Back-calculate from Current Value - NetFlow 
                    // (The value "before" the transaction happened)
                    // If current value is null, we can't back-calc, so assume flat from previous (or let fill logic handle)
                    // If current value is set, we assume that includes the flow. 
                    let fillValue = prev.value;
                    if (curr.value !== null) {
                        // User request: "If 1/8 has 10k deposit, previous day likely 10k lower"
                        fillValue = curr.value - curr.netFlow;
                        if (fillValue < 0) fillValue = 0; // Guard
                    }

                    processed.push({
                        date: dayBeforeVar,
                        value: fillValue,
                        cost: fillCost,
                        netFlow: 0
                    });
                }

                // Process current point
                // Logic to carry over value if null
                const valFromPrev = (prev.value || 0) + curr.netFlow;
                let actualValue: number = curr.value !== null ? curr.value : valFromPrev;
                if (actualValue < 0) actualValue = 0;

                processed.push({
                    date: curr.date,
                    value: actualValue,
                    cost: curr.cost,
                    netFlow: curr.netFlow
                });
            }

            return processed.map(p => {
                const realizedGain = (c.transactions || [])
                    .filter((t) => t.transactedAt <= p.date)
                    .reduce((acc: number, t) => acc + Number(t.realizedGain || 0), 0);
                return {
                    date: p.date,
                    value: p.value,
                    cost: p.cost,
                    realizedGain,
                };
            });
        };

        const hasChildren = catWithNested.children && catWithNested.children.length > 0;
        let history: Record<string, number | string>[] = [];
        let currentValue = 0;
        let costBasis = 0;
        let childrenInfo: { id: number, name: string, color: string, currentValue: number, costBasis: number, isLiability: boolean }[] = [];

        if (hasChildren) {
            // Include parent itself + all descendants for merging history
            const allToProcess = [catWithNested, ...(catWithNested as any).allDescendants];
            const allHistories = allToProcess.map((c: any) => ({
                id: c.id,
                parentId: c.parentId,
                items: calculateHistoryForCategory(c)
            }));

            // Collect all unique dates
            const allDates = new Set<string>();
            allHistories.forEach((ch: any) => {
                ch.items.forEach((i: { date: Date }) => allDates.add(getCalendarDayKey(i.date)));
            });
            const sortedDates = Array.from(allDates).sort();

            const runningValues: Record<number, number> = {};
            const runningCosts: Record<number, number> = {};
            const runningRealizedGains: Record<number, number> = {};

            history = sortedDates.map(dateStr => {
                const point: Record<string, number | string> = { date: dateStr, value: 0, cost: 0, childrenValue: 0, realizedGain: 0 };

                allHistories.forEach((ch: any) => {
                    const entry = ch.items.find((i: { date: Date }) => getCalendarDayKey(i.date) === dateStr);
                    if (entry) {
                        runningValues[ch.id] = (entry as { value: number }).value;
                        runningCosts[ch.id] = (entry as { cost: number }).cost;
                        runningRealizedGains[ch.id] = (entry as { realizedGain: number }).realizedGain;
                    }

                    const val = runningValues[ch.id] || 0;
                    point.value = (point.value as number) + val;
                    point.cost = (point.cost as number) + (runningCosts[ch.id] || 0);
                    point.realizedGain = (point.realizedGain as number) + (runningRealizedGains[ch.id] || 0);

                    // If it's a descendant
                    if (ch.id !== catWithNested.id) {
                        point.childrenValue = (point.childrenValue as number) + val;
                    }
                });

                // For chart series: sum each direct child + its descendants
                catWithNested.children.forEach((directChild: any) => {
                    const getRecursiveSum = (pid: number, field: "value" | "cost" | "realizedGain"): number => {
                        const source = field === "value"
                            ? runningValues
                            : field === "cost"
                                ? runningCosts
                                : runningRealizedGains;
                        const self = source[pid] || 0;
                        const subChildren = allHistories.filter((h: any) => h.parentId === pid);
                        return self + subChildren.reduce((sum: number, c: any) => sum + getRecursiveSum(c.id, field), 0);
                    };
                    point[`child_${directChild.id}`] = getRecursiveSum(directChild.id, "value");
                    point[`child_cost_${directChild.id}`] = getRecursiveSum(directChild.id, "cost");
                    point[`child_realized_gain_${directChild.id}`] = getRecursiveSum(directChild.id, "realizedGain");
                });

                return point;
            });

            // Update currentValue and childrenInfo
            childrenInfo = catWithNested.children.map((c: any) => {
                const getRecursiveCurrentValue = (catObj: any): number => {
                    const lastAs = catObj.assets && catObj.assets.length > 0 ? catObj.assets[catObj.assets.length - 1] : null;
                    const val = Number(lastAs?.currentValue || 0);
                    const subDescendants = (catWithNested as any).allDescendants.filter((d: any) => d.parentId === catObj.id);
                    return val + subDescendants.reduce((sum: number, sd: any) => sum + getRecursiveCurrentValue(sd), 0);
                };
                const getRecursiveCostBasis = (catObj: any): number => {
                    const cost = (catObj.transactions || [])
                        .reduce((sum: number, t: { type: string; amount: number }) => {
                            const amt = Number(t.amount);
                            if (t.type === "DEPOSIT") return sum + amt;
                            if (t.type === "WITHDRAW") return sum - amt;
                            return sum;
                        }, 0);
                    const subDescendants = (catWithNested as any).allDescendants.filter((d: any) => d.parentId === catObj.id);
                    return Math.max(0, cost + subDescendants.reduce((sum: number, sd: any) => sum + getRecursiveCostBasis(sd), 0));
                };

                return {
                    id: c.id,
                    name: c.name,
                    color: c.color || "#ccc",
                    currentValue: getRecursiveCurrentValue(c),
                    costBasis: getRecursiveCostBasis(c),
                    isLiability: false
                };
            });

            currentValue = catWithNested.children.reduce((sum, c) => sum + (childrenInfo.find(ci => ci.id === c.id)?.currentValue || 0), 0);
            const ownLatest = catWithNested.assets && catWithNested.assets.length > 0 ? catWithNested.assets[catWithNested.assets.length - 1] : null;
            currentValue += Number(ownLatest?.currentValue || 0);

            // Recalculate cost basis
            costBasis = history.length > 0 ? Number(history[history.length - 1].cost || 0) : 0;

        } else {
            // Single Category Logic
            const rawHistory = calculateHistoryForCategory(catWithNested);
            history = rawHistory.map(h => ({
                date: h.date.toISOString(),
                value: h.value as number,
                cost: h.cost,
                realizedGain: h.realizedGain,
            }));

            const latestAsset = catWithNested.assets.length > 0 ? catWithNested.assets[catWithNested.assets.length - 1] : null;
            currentValue = Number(latestAsset?.currentValue || 0);
            costBasis = rawHistory.length > 0 ? rawHistory[rawHistory.length - 1].cost : 0;

            // Use fallback logic for costBasis if history is empty but standard calculation exists
            if (history.length === 0 && catWithNested.isCash) {
                costBasis = currentValue;
                history.push({
                    date: new Date().toISOString(),
                    value: currentValue,
                    cost: costBasis,
                    realizedGain: 0,
                });
            }
        }

        // Transactions & Assets
        const formatTx = (t: { id: number, transactedAt: Date, type: string, amount: number, memo: string | null, realizedGain: number | null }, catName: string, catColor: string, catId: number) => ({
            id: `tx-${t.id}`,
            rawDate: t.transactedAt,
            date: t.transactedAt.toISOString(),
            type: t.type,
            amount: t.amount,
            memo: t.memo,
            pointInTimeValuation: null as number | null,
            categoryName: catName,
            categoryColor: catColor,
            categoryId: catId,
            realizedGain: t.realizedGain
        });

        const formatAsset = (a: { id: number, recordedAt: Date, currentValue: number }, catName: string, catColor: string, catId: number) => ({
            id: `as-${a.id}`,
            rawDate: a.recordedAt,
            date: a.recordedAt.toISOString(),
            type: 'VALUATION',
            amount: 0,
            pointInTimeValuation: a.currentValue,
            memo: '評価額更新',
            categoryName: catName,
            categoryColor: catColor,
            categoryId: catId
        });

        const rawTransactions = [
            ...(catWithNested.transactions || []).map((t) => formatTx(t, catWithNested.name, catWithNested.color || "#ccc", catWithNested.id)),
            ...((catWithNested as any).allDescendants || []).flatMap((c: any) => (c.transactions || []).map((t: any) => formatTx(t, c.name, c.color || "#ccc", c.id)))
        ];

        const rawAssets = [
            ...(catWithNested.assets || []).map((a) => formatAsset(a, catWithNested.name, catWithNested.color || "#ccc", catWithNested.id)),
            ...((catWithNested as any).allDescendants || []).flatMap((c: any) => (c.assets || []).map((a: any) => formatAsset(a, c.name, c.color || "#ccc", c.id)))
        ];

        // Merge logic: Group by CategoryId + Date (YYYY-MM-DD)
        const allRaw = [...rawTransactions, ...rawAssets].sort((a, b) => b.rawDate.getTime() - a.rawDate.getTime());
        interface MergedItem {
            id: string;
            rawDate: Date;
            date: string;
            type: string;
            amount: number;
            memo: string | null;
            pointInTimeValuation: number | null;
            categoryName: string;
            categoryColor: string;
            categoryId: number;
            realizedGain?: number | null;
            profitRatio?: number | null;
            consolidatedValuation?: number;
            childrenValuation?: number;
        }
        const mergedList: MergedItem[] = [];

        const groups = new Map<string, MergedItem[]>();
        allRaw.forEach(item => {
            const day = item.date.split('T')[0];
            const key = `${item.categoryId}_${day}`;
            if (!groups.has(key)) groups.set(key, []);
            const group = groups.get(key);
            if (group) group.push(item);
        });

        groups.forEach(groupItems => {
            groupItems.sort((a, b) => b.rawDate.getTime() - a.rawDate.getTime());
            const txs = groupItems.filter(i => i.id.startsWith('tx-'));
            const ass = groupItems.filter(i => i.id.startsWith('as-'));

            if (txs.length > 0 && ass.length > 0) {
                const latestTx = txs[0];
                const latestAs = ass[0];
                latestTx.pointInTimeValuation = latestAs.pointInTimeValuation;
                txs.forEach(t => mergedList.push(t));
                ass.slice(1).forEach(a => mergedList.push(a));
            } else {
                groupItems.forEach(i => mergedList.push(i));
            }
        });

        mergedList.forEach((item) => {
            const dateStr = item.date.split('T')[0];
            const historyItem = history.find((h) => (h.date as string).startsWith(dateStr));

            if (historyItem) {
                if (Number(historyItem.cost) > 0) {
                    const profit = (historyItem.value as number) - (historyItem.cost as number);
                    item.profitRatio = (profit / (historyItem.cost as number)) * 100;
                } else {
                    item.profitRatio = null;
                }

                item.consolidatedValuation = historyItem.value as number;
                item.childrenValuation = historyItem.childrenValue as number;

                if (item.pointInTimeValuation === null || item.pointInTimeValuation === undefined) {
                    // Fallback to the specific category's value on that day if possible? 
                    // No, historyItem.value is consolidated.
                    // We don't have individual values in mergedList items easily here 
                    // unless we use runningValues during history calculation.
                }
            } else {
                item.profitRatio = null;
            }
        });

        mergedList.sort((a, b) => b.rawDate.getTime() - a.rawDate.getTime());

        return {
            id: catWithNested.id,
            name: catWithNested.name,
            color: catWithNested.color || "#ccc",
            isCash: catWithNested.isCash,
            isLiability: false,
            currentValue,
            costBasis,
            tags: (catWithNested.tags || []).map((t) => t.tagOption?.name),
            history,
            children: childrenInfo,
            allDescendants: (catWithNested as any).allDescendants.map((d: any) => ({
                id: d.id,
                name: d.name
            })),
            parent: catWithNested.parent ? { id: catWithNested.parent.id, name: catWithNested.parent.name } : null,
            transactions: mergedList.map((item) => {
                const { rawDate, ...rest } = item
                void rawDate
                return {
                    ...rest,
                    amount: Number(rest.amount),
                    realizedGain: rest.realizedGain != null ? Number(rest.realizedGain) : null,
                    pointInTimeValuation:
                        rest.pointInTimeValuation != null ? Number(rest.pointInTimeValuation) : null,
                }
            })
        };
    } catch (error) {
        console.error("Fetch detail error", error);
        return null;
    }
}



export async function updateValuationSettingsAction(settings: {
    id: number
    valuationOrder: number
    isValuationTarget: boolean
    valuationAlias?: string | null
}[]) {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }

        const ids = settings.map((s) => s.id)
        const owned = await prisma.category.findMany({ where: { id: { in: ids }, userId }, select: { id: true } })
        if (owned.length !== ids.length) return { success: false, error: "カテゴリが見つかりません" }

        await prisma.$transaction(
            settings.map(s =>
                prisma.category.update({
                    where: { id: s.id },
                    data: {
                        valuationOrder: s.valuationOrder,
                        isValuationTarget: s.isValuationTarget,
                        valuationAlias: s.valuationAlias?.trim() || null,
                    }
                })
            )
        );
        revalidatePath("/");
        revalidatePath("/data-fetch");
        invalidateDashboard(userId);
        return { success: true };
    } catch (e) {
        console.error("Failed to update valuation settings", e);
        return { success: false };
    }
}

export async function toggleCategoryVisibility(id: number, hidden: boolean) {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }

        const result = await prisma.category.updateMany({
            where: { id, userId },
            data: { hidden }
        });
        if (result.count === 0) return { success: false, error: "カテゴリが見つかりません" }

        revalidatePath("/");
        invalidateDashboard(userId);
        return { success: true };
    } catch (error) {
        console.error("Toggle visibility error", error);
        return { success: false };
    }
}
