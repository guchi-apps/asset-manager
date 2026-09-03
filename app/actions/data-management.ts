"use server"

import { prisma } from "@/lib/prisma"
import { getCurrentUserId } from "@/lib/auth"
import { getCalendarDayKey, parseValuationDateInput } from "@/lib/valuation-day"

// Helper to escape CSV fields
function escapeCsv(field: string | number | null | undefined): string {
    if (field === null || field === undefined) return "";
    const str = String(field);
    if (str.includes(",") || str.includes("\"") || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

// Helper to format date in JST for CSV
function formatDateJst(date: Date): string {
    return getCalendarDayKey(date);
}

export async function exportAllData() {
    try {
        const userId = await getCurrentUserId()
        if (!userId) {
            return { success: false, error: "認証が必要です" };
        }
        const transactions = await prisma.transaction.findMany({
            where: { userId: userId! },
            include: { category: true },
            orderBy: { transactedAt: 'asc' }
        });

        // Use Asset model for Valuation History
        const valuations = await prisma.asset.findMany({
            where: { userId: userId! },
            include: { category: true },
            orderBy: { recordedAt: 'asc' }
        });

        // Combine data for sorting
        // Unified type shape for export
        const combinedData: {
            date: Date;
            categoryId: number;
            name: string;
            type: string;
            amount: number;
            valuation: number | null;
            memo: string | null
        }[] = [];

        transactions.forEach(t => {
            let typeStr = 'その他';
            if (t.type === 'DEPOSIT') typeStr = '入金';
            else if (t.type === 'WITHDRAW') typeStr = '出金';
            else if (t.type === 'VALUATION') typeStr = '評価額調整';

            const amount = t.type === 'WITHDRAW' ? -t.amount : t.amount;

            combinedData.push({
                date: t.transactedAt,
                categoryId: t.categoryId,
                name: t.category.name,
                type: typeStr,
                amount: amount,
                valuation: null,
                memo: t.memo
            });
        });

        valuations.forEach(v => {
            combinedData.push({
                date: v.recordedAt,
                categoryId: v.categoryId,
                name: v.category.name,
                type: '評価額',
                amount: 0,
                valuation: v.currentValue,
                memo: ''
            });
        });

        // Sort by date
        combinedData.sort((a, b) => a.date.getTime() - b.date.getTime());

        const header = "日付,資産ID,資産名,種別,金額,評価額,メモ";
        const rows = combinedData.map(d => [
            escapeCsv(formatDateJst(d.date)),
            escapeCsv(d.categoryId),
            escapeCsv(d.name),
            escapeCsv(d.type),
            escapeCsv(d.amount),
            escapeCsv(d.valuation),
            escapeCsv(d.memo)
        ].join(","));

        return { success: true, csv: [header, ...rows].join("\n") };

    } catch (error) {
        console.error("Export error:", error);
        return { success: false, error: "エクスポートに失敗しました" };
    }
}


export async function getTemplateCsv(targetAssetId?: number) {
    try {
        const category = targetAssetId ? await prisma.category.findUnique({ where: { id: targetAssetId } }) : null;
        const isSimpleAsset = category?.isCash;

        if (isSimpleAsset) {
            const header = "操作,ID,日付,評価額,メモ";
            const rows = [header];

            // Prepend history if needed
            if (targetAssetId) {
                try {
                    const valuations = await prisma.asset.findMany({
                        where: { categoryId: targetAssetId },
                        orderBy: { recordedAt: 'asc' }
                    });

                    valuations.forEach(v => {
                        rows.push([
                            "I", // Ignore by default
                            v.id.toString(),
                            formatDateJst(v.recordedAt),
                            v.currentValue.toString(),
                            "(既存データ)"
                        ].join(","));
                    });
                } catch {
                    console.error("Failed to fetch history for simple template");
                }
            }

            return rows.join("\n");
        }

        const header = "操作,ID,日付,入金額,出金額,売却額,評価額,メモ";
        const rows = [header];

        // Check if we need to prepend history for a specific asset
        if (targetAssetId) {
            try {
                // Fetch history for this asset
                const transactions = await prisma.transaction.findMany({
                    where: { categoryId: targetAssetId },
                    orderBy: { transactedAt: 'asc' }
                });
                const valuations = await prisma.asset.findMany({
                    where: { categoryId: targetAssetId },
                    orderBy: { recordedAt: 'asc' }
                });

                const history: { id: string, date: Date, deposit: string, withdraw: string, sell: string, val: string, memo: string }[] = [];

                transactions.forEach(t => {
                    const isDeposit = t.type === 'DEPOSIT';
                    const isWithdraw = t.type === 'WITHDRAW';

                    let sell = "";
                    if (isWithdraw && t.realizedGain !== null) {
                        sell = (t.realizedGain + t.amount).toString();
                    }

                    history.push({
                        id: `T-${t.id}`,
                        date: t.transactedAt,
                        deposit: isDeposit ? t.amount.toString() : "",
                        withdraw: isWithdraw ? t.amount.toString() : "",
                        sell: sell,
                        val: "",
                        memo: t.memo || ""
                    });
                });

                valuations.forEach(v => {
                    history.push({
                        id: `V-${v.id}`,
                        date: v.recordedAt,
                        deposit: "",
                        withdraw: "",
                        sell: "",
                        val: v.currentValue.toString(),
                        memo: "(評価額)"
                    });
                });

                // Sort ascending
                history.sort((a, b) => a.date.getTime() - b.date.getTime());

                history.forEach(h => {
                    rows.push([
                        "I", // Ignore by default
                        h.id,
                        formatDateJst(h.date),
                        h.deposit,
                        h.withdraw,
                        h.sell,
                        h.val,
                        h.memo
                    ].join(","));
                });
            } catch {
                console.error("Failed to fetch history for template");
            }
        }

        return rows.join("\n");
    } catch (error) {
        console.error("Template generation error:", error);
        return "";
    }
}

export async function importData(csvContent: string, targetAssetId: number) {
    try {
        const userId = await getCurrentUserId()
        if (!userId) {
            return { success: false, error: "認証が必要です" };
        }
        if (!targetAssetId) {
            return { success: false, error: "対象資産が選択されていません" };
        }

        const category = await prisma.category.findFirst({ where: { id: targetAssetId, userId } });
        if (!category) {
            return { success: false, error: "選択された資産が存在しません" };
        }

        const lines = csvContent.split(/\r?\n/);
        let importedCount = 0;
        let errorCount = 0;
        const errors: string[] = [];
        const successDetails: string[] = [];

        // Simple CSV parser
        const parseLine = (text: string) => {
            const result = [];
            let current = '';
            let inQuote = false;
            for (let i = 0; i < text.length; i++) {
                const char = text[i];
                if (char === '"') {
                    if (inQuote && text[i + 1] === '"') {
                        current += '"';
                        i++;
                    } else {
                        inQuote = !inQuote;
                    }
                } else if (char === ',' && !inQuote) {
                    result.push(current);
                    current = '';
                } else {
                    current += char;
                }
            }
            result.push(current);
            return result;
        };

        const headerLine = lines[0].trim();
        const isSimpleFormat = headerLine.includes("評価額") && !headerLine.includes("入金額");
        const isSimpleAsset = category.isCash;

        for (let i = 1; i < lines.length; i++) { // Skip header
            const line = lines[i].trim();
            if (!line) continue;
            if (line.startsWith("#")) continue;

            const parts = parseLine(line);

            // Row processing
            const action = parts[0]?.trim().toUpperCase();
            const recordId = parts[1]?.trim();

            if (action === "I") continue; // Ignore

            // Delete operation
            if (action === "D" && recordId) {
                try {
                    let deletedCount = 0;
                    if (recordId.startsWith("T-")) {
                        const result = await prisma.transaction.deleteMany({
                            where: { id: parseInt(recordId.replace("T-", "")), userId }
                        });
                        deletedCount = result.count;
                        if (deletedCount > 0) successDetails.push(`削除: 取引ID ${recordId}`);
                    } else if (recordId.startsWith("V-") || !isNaN(parseInt(recordId))) {
                        const id = recordId.startsWith("V-") ? parseInt(recordId.replace("V-", "")) : parseInt(recordId);
                        const result = await prisma.asset.deleteMany({ where: { id, userId } });
                        deletedCount = result.count;
                        if (deletedCount > 0) successDetails.push(`削除: 評価額ID ${recordId}`);
                    }
                    if (deletedCount === 0) {
                        throw new Error("not found or not owned");
                    }
                    importedCount++;
                    continue;
                } catch {
                    errorCount++;
                    errors.push(`${i + 1}行目: 削除に失敗しました (ID: ${recordId})`);
                    continue;
                }
            }

            let dateStr: string, valuationStr: string, memo: string;
            let depositStr = "", withdrawStr = "", sellStr = "";

            if (isSimpleFormat) {
                // Expected: 操作, ID, 日付, 評価額, メモ
                if (parts.length < 4) {
                    errorCount++;
                    errors.push(`${i + 1}行目: カラム数が不足しています`);
                    continue;
                }
                dateStr = parts[2]?.trim();
                valuationStr = parts[3]?.trim();
                memo = parts[4]?.trim() || "";
            } else {
                // Expected: 操作, ID, 日付, 入金額, 出金額, 売却額, 評価額, メモ
                if (parts.length < 7) {
                    errorCount++;
                    errors.push(`${i + 1}行目: カラム数が不足しています`);
                    continue;
                }
                dateStr = parts[2]?.trim();
                depositStr = parts[3]?.trim();
                withdrawStr = parts[4]?.trim();
                sellStr = parts[5]?.trim();
                valuationStr = parts[6]?.trim();
                memo = parts[7]?.trim() || "";
            }

            if (!dateStr || dateStr.startsWith("---") || dateStr.startsWith("日付") || dateStr.startsWith("#")) {
                continue;
            }

            // Fix Date: Robust normalization to YYYY-MM-DD
            let normalizedDateStr = dateStr.replace(/\//g, "-");
            const dateParts = normalizedDateStr.split("-");
            if (dateParts.length === 3) {
                const y = dateParts[0];
                const m = dateParts[1].padStart(2, '0');
                const d = dateParts[2].padStart(2, '0');
                normalizedDateStr = `${y}-${m}-${d}`;
            }

            const date = parseValuationDateInput(normalizedDateStr);
            if (isNaN(date.getTime())) {
                errorCount++;
                errors.push(`${i + 1}行目: 無効な日付フォーマットです (${dateStr})`);
                continue;
            }

            const isFuture = date.getTime() > new Date().getTime();
            const futureNote = isFuture ? " [未来日]" : "";

            // For Cash categories, we ONLY process valuations
            if (isSimpleAsset) {
                if (!valuationStr) {
                    errorCount++;
                    errors.push(`${i + 1}行目: 評価額が入力されていません`);
                    continue;
                }
                const val = parseFloat(valuationStr);
                if (isNaN(val)) {
                    errorCount++;
                    errors.push(`${i + 1}行目: 評価額が無効です`);
                    continue;
                }

                try {
                    await prisma.asset.create({
                        data: {
                            categoryId: targetAssetId,
                            userId: userId!,
                            recordedAt: date,
                            currentValue: val
                        }
                    });
                    importedCount++;
                    successDetails.push(`${dateStr}: ${val.toLocaleString()} (評価額)${futureNote}`);
                } catch {
                    errorCount++;
                    errors.push(`${i + 1}行目: データベースエラー`);
                }
                continue; // Skip transaction processing for simple assets
            }

            // --- Regular Asset Processing (Stocks, etc.) ---
            const hasDeposit = !!depositStr;
            const hasWithdraw = !!withdrawStr;
            const hasSell = !!sellStr;
            const hasValuation = !!valuationStr;

            if (hasDeposit && hasWithdraw) {
                errorCount++;
                errors.push(`${i + 1}行目: 入金額と出金額が同時に入力されています`);
                continue;
            }

            if ((hasWithdraw && !hasSell) || (!hasWithdraw && hasSell)) {
                errorCount++;
                errors.push(`${i + 1}行目: 出金（元本減少）と売却額はセットで入力する必要があります`);
                continue;
            }

            let depositVal = 0, withdrawVal = 0, sellVal = 0, valuationVal = 0;

            if (hasDeposit) {
                depositVal = parseFloat(depositStr!);
                if (isNaN(depositVal)) {
                    errorCount++;
                    errors.push(`${i + 1}行目: 入金額が無効です`);
                    continue;
                }
            }
            if (hasWithdraw) {
                withdrawVal = parseFloat(withdrawStr!);
                if (isNaN(withdrawVal)) {
                    errorCount++;
                    errors.push(`${i + 1}行目: 出金額が無効です`);
                    continue;
                }
            }
            if (hasSell) {
                sellVal = parseFloat(sellStr!);
                if (isNaN(sellVal)) {
                    errorCount++;
                    errors.push(`${i + 1}行目: 売却額が無効です`);
                    continue;
                }
            }
            if (hasValuation) {
                valuationVal = parseFloat(valuationStr!);
                if (isNaN(valuationVal)) {
                    errorCount++;
                    errors.push(`${i + 1}行目: 評価額が無効です`);
                    continue;
                }
            }

            if (!hasDeposit && !hasWithdraw && !hasValuation) {
                errorCount++;
                errors.push(`${i + 1}行目: 金額が入力されていません`);
                continue;
            }

            try {
                if (hasValuation) {
                    await prisma.asset.create({
                        data: {
                            categoryId: targetAssetId,
                            userId: userId!,
                            recordedAt: date,
                            currentValue: valuationVal
                        }
                    });
                }

                if (hasDeposit) {
                    await prisma.transaction.create({
                        data: {
                            categoryId: targetAssetId,
                            userId: userId!,
                            transactedAt: date,
                            type: 'DEPOSIT',
                            amount: Math.abs(depositVal),
                            memo: memo
                        }
                    });
                }

                if (hasWithdraw) {
                    await prisma.transaction.create({
                        data: {
                            categoryId: targetAssetId,
                            userId: userId!,
                            transactedAt: date,
                            type: 'WITHDRAW',
                            amount: Math.abs(withdrawVal),
                            realizedGain: sellVal - Math.abs(withdrawVal),
                            memo: memo
                        }
                    });
                }

                importedCount++;
                const details = [];
                if (hasDeposit) details.push(`入金 ${depositVal.toLocaleString()}`);
                if (hasWithdraw) details.push(`出金 ${withdrawVal.toLocaleString()}`);
                if (hasValuation) details.push(`評価額 ${valuationVal.toLocaleString()}`);
                successDetails.push(`${dateStr}: ${details.join(", ")} ${memo ? `(${memo})` : ""}${futureNote}`);

            } catch (e) {
                errorCount++;
                errors.push(`${i + 1}行目: データベースエラー`);
                console.error(e);
            }
        }

        return { success: true, importedCount, errorCount, errors, successDetails };

    } catch (error) {
        console.error("Import error:", error);
        return { success: false, error: "インポート処理全体でエラーが発生しました" };
    }
}
