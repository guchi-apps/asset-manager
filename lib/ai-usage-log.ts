/**
 * AIの使用量の保存と集計（Issue #535）。DBに触れる部分だけをここに置く。
 * 集計結果を返す形は `lib/ai-usage.ts`。
 */

import { prisma } from "@/lib/prisma"
import {
    LAST_24H_MS,
    LAST_7D_MS,
    buildAiUsageResponse,
    type AiUsageGroup,
    type AiUsageRecord,
    type AiUsageResponse,
} from "@/lib/ai-usage"

/** Anthropic API の1回の呼び出しぶんを記録する。 */
export async function saveAiUsage(record: AiUsageRecord): Promise<void> {
    await prisma.aiUsageLog.create({
        data: {
            feature: record.feature,
            model: record.model,
            inputTokens: record.inputTokens,
            outputTokens: record.outputTokens,
            cacheReadTokens: record.cacheReadTokens,
            cacheWriteTokens: record.cacheWriteTokens,
        },
    })
}

async function sumSince(since: Date, until: Date): Promise<AiUsageGroup[]> {
    const rows = await prisma.aiUsageLog.groupBy({
        by: ["feature", "model"],
        // 24時間側も7日間側も同じ `until` で切る。別々に現在時刻を取ると、
        // 2つのクエリの合間に入った呼び出しが24時間側にだけ数えられうる。
        where: { createdAt: { gte: since, lte: until } },
        _count: { _all: true },
        _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true },
    })

    return rows.map((row) => ({
        feature: row.feature,
        model: row.model,
        calls: row._count._all,
        inputTokens: row._sum.inputTokens ?? 0,
        outputTokens: row._sum.outputTokens ?? 0,
        cacheReadTokens: row._sum.cacheReadTokens ?? 0,
        cacheWriteTokens: row._sum.cacheWriteTokens ?? 0,
    }))
}

/** 機能×モデルごとの、直近24時間・7日間の使用量。 */
export async function getAiUsageResponse(now = new Date()): Promise<AiUsageResponse> {
    const [last24h, last7d] = await Promise.all([
        sumSince(new Date(now.getTime() - LAST_24H_MS), now),
        sumSince(new Date(now.getTime() - LAST_7D_MS), now),
    ])
    return buildAiUsageResponse(last24h, last7d)
}
