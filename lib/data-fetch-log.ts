/**
 * 自動取得の結果をDBへ残し、画面から読み出す（Issue #269）。
 *
 * 結果はこれまでVPSのPM2ログと、異常時だけ飛ぶSignalyの通知にしか残っておらず、
 * 「何が反映され、何が反映されなかったか」を後から画面で追えなかった。
 *
 * **記録は表示のためだけのもので、取得・保存の成否を左右しない。** 記録に失敗しても
 * 呼び出し元を止めない（毎晩の定期実行を、ログの書き込み失敗で落とさない）。
 * 表示用の整形は `lib/data-fetch-view.ts`（純粋関数）にある。
 */

import { prisma } from "@/lib/prisma"
import {
    resolveDataFetchStatus,
    resolveDataFetchTrigger,
    type DataFetchJobKey,
    type DataFetchOutcomeKey,
    type DataFetchStatusKey,
    type DataFetchTriggerKey,
} from "@/lib/data-fetch-view"

/**
 * 記録を残す期間。毎晩2本×明細数ぶん増えるため、際限なく貯めない。
 * 画面の履歴が見るのは直近30日で、それより手前は原因を追うための余裕。
 */
export const DATA_FETCH_RUN_RETENTION_DAYS = 90

/** 画面の履歴に出す実行の件数。1日2本なので30日ぶんに少し余裕を持たせる。 */
export const DATA_FETCH_HISTORY_LIMIT = 80

export interface DataFetchItemInput {
    outcome: DataFetchOutcomeKey
    /** 反映先の名前（カテゴリ名・指数名） */
    label: string
    /** 反映元の名前（Zaimの表示名・指数のシンボル） */
    source?: string | null
    amount?: number | null
    previousValue?: number | null
    recordDay?: string | null
    reason?: string | null
    detail?: string | null
}

export interface RecordDataFetchRunInput {
    userId: string
    job: DataFetchJobKey
    startedAt: Date
    /** 何日ぶんとして取得したか（JSTの `YYYY-MM-DD`）。Zaimは巡回日。 */
    targetDay?: string | null
    /** 取得元の状態を一行で（例: AIDEの巡回時刻）。 */
    sourceLabel?: string | null
    /** 実行全体の結果。見送った・失敗した場合はその理由。 */
    message?: string | null
    /**
     * 取得元が古い・空だったため、保存に進まずに終えたか。
     * 「1件も反映できなかった」とは原因が違うため、状態を分けて残す。
     */
    nothingSaved?: boolean
    /**
     * 実行のきっかけ。省略すると起動時刻とPM2の有無から決める（#276）。
     * デプロイ直後の1回を「今日の定期実行」として画面に出さないために持つ。
     */
    trigger?: DataFetchTriggerKey
    items: DataFetchItemInput[]
}

function countItems(items: DataFetchItemInput[]) {
    return {
        reflected: items.filter((item) => item.outcome === "REFLECTED").length,
        skipped: items.filter((item) => item.outcome === "SKIPPED").length,
        unmatched: items.filter((item) => item.outcome === "UNMATCHED").length,
        failed: items.filter((item) => item.outcome === "FAILED").length,
    }
}

/**
 * 実行1回ぶんの結果を記録する。**例外を投げない。**
 *
 * 呼び出し元は毎晩の定期実行で、確認する人がいない。記録できなかったことを理由に
 * 保存済みの評価額まで失うほうが損なので、失敗はログに出して握りつぶす。
 */
export async function recordDataFetchRun(input: RecordDataFetchRunInput): Promise<void> {
    const counts = countItems(input.items)
    const status: DataFetchStatusKey = resolveDataFetchStatus(counts, {
        nothingSaved: input.nothingSaved,
    })
    const trigger: DataFetchTriggerKey =
        input.trigger ??
        resolveDataFetchTrigger({
            job: input.job,
            at: input.startedAt,
            underPm2: Boolean(process.env.pm_id),
        })

    try {
        await prisma.dataFetchRun.create({
            data: {
                userId: input.userId,
                job: input.job,
                status,
                trigger,
                startedAt: input.startedAt,
                finishedAt: new Date(),
                targetDay: input.targetDay ?? null,
                sourceLabel: input.sourceLabel ?? null,
                message: input.message ?? null,
                ...counts,
                items: {
                    create: input.items.map((item, index) => ({
                        order: index,
                        outcome: item.outcome,
                        label: item.label,
                        source: item.source ?? null,
                        amount: item.amount ?? null,
                        previousValue: item.previousValue ?? null,
                        recordDay: item.recordDay ?? null,
                        reason: item.reason ?? null,
                        detail: item.detail ?? null,
                    })),
                },
            },
        })

        await pruneDataFetchRuns(input.userId)
    } catch (error) {
        console.error("取得結果の記録に失敗しました（取得そのものには影響しません）", error)
    }
}

/**
 * 保持期間を過ぎた記録を消す。
 *
 * `relationMode = "prisma"` のため外部キーが張られておらず、実行を消しても明細は
 * DB側では消えない。明細を先に消してから実行を消す。
 */
export async function pruneDataFetchRuns(userId: string, now = new Date()): Promise<number> {
    const threshold = new Date(now.getTime() - DATA_FETCH_RUN_RETENTION_DAYS * 24 * 60 * 60 * 1000)
    const expired = await prisma.dataFetchRun.findMany({
        where: { userId, startedAt: { lt: threshold } },
        select: { id: true },
    })
    if (expired.length === 0) return 0

    const ids = expired.map((run) => run.id)
    await prisma.dataFetchItem.deleteMany({ where: { runId: { in: ids } } })
    await prisma.dataFetchRun.deleteMany({ where: { id: { in: ids } } })
    return ids.length
}

/**
 * 画面へ渡す形。Dateではなく ISO8601 の文字列で持つ
 * （表示はクライアント側の純粋関数がJSTへ畳むため、Dateのまま渡す必要が無い）。
 */
export interface DataFetchItemView {
    id: number
    outcome: DataFetchOutcomeKey
    label: string
    source: string | null
    amount: number | null
    previousValue: number | null
    recordDay: string | null
    reason: string | null
    detail: string | null
}

export interface DataFetchRunView {
    id: number
    job: DataFetchJobKey
    status: DataFetchStatusKey
    trigger: DataFetchTriggerKey
    startedAt: string
    finishedAt: string | null
    targetDay: string | null
    sourceLabel: string | null
    message: string | null
    reflected: number
    skipped: number
    unmatched: number
    failed: number
}

export interface DataFetchRunDetail extends DataFetchRunView {
    items: DataFetchItemView[]
}

type RunRow = {
    id: number
    job: string
    status: string
    trigger: string
    startedAt: Date
    finishedAt: Date | null
    targetDay: string | null
    sourceLabel: string | null
    message: string | null
    reflected: number
    skipped: number
    unmatched: number
    failed: number
}

function toRunView(run: RunRow): DataFetchRunView {
    return {
        id: run.id,
        job: run.job as DataFetchJobKey,
        status: run.status as DataFetchStatusKey,
        trigger: run.trigger as DataFetchTriggerKey,
        startedAt: run.startedAt.toISOString(),
        finishedAt: run.finishedAt?.toISOString() ?? null,
        targetDay: run.targetDay,
        sourceLabel: run.sourceLabel,
        message: run.message,
        reflected: run.reflected,
        skipped: run.skipped,
        unmatched: run.unmatched,
        failed: run.failed,
    }
}

/**
 * ジョブごとの最新の実行。まだ一度も動いていないジョブは含まれない。
 *
 * **拾うのは定期実行ぶんだけ**（#276）。デプロイ直後の1回は前回の巡回結果を読むため
 * ほぼ必ず反映0件で終わり、これを最新として出すと「今日は何も反映されていない」と読める。
 * まだ定期実行が一度も走っていない場合だけ、直近の実行（デプロイ直後・手動）へ落とす。
 * 画面はそのとき `trigger` のバッジで理由を出す。
 */
export async function getLatestDataFetchRuns(userId: string): Promise<DataFetchRunDetail[]> {
    const jobs: DataFetchJobKey[] = ["ZAIM_VALUATION", "INDEX_VALUE", "RECURRING_DEPOSIT"]

    const runs = await Promise.all(
        jobs.map(async (job) => {
            const include = { items: { orderBy: { order: "asc" as const } } }
            const scheduled = await prisma.dataFetchRun.findFirst({
                where: { userId, job, trigger: "SCHEDULED" },
                orderBy: { startedAt: "desc" },
                include,
            })
            if (scheduled) return scheduled

            return prisma.dataFetchRun.findFirst({
                where: { userId, job },
                orderBy: { startedAt: "desc" },
                include,
            })
        })
    )

    return runs.flatMap((run) =>
        run ? [{ ...toRunView(run), items: run.items.map(toItemView) }] : []
    )
}

function toItemView(item: {
    id: number
    outcome: string
    label: string
    source: string | null
    amount: number | null
    previousValue: number | null
    recordDay: string | null
    reason: string | null
    detail: string | null
}): DataFetchItemView {
    return {
        id: item.id,
        outcome: item.outcome as DataFetchOutcomeKey,
        label: item.label,
        source: item.source,
        amount: item.amount,
        previousValue: item.previousValue,
        recordDay: item.recordDay,
        reason: item.reason,
        detail: item.detail,
    }
}

/** 実行履歴（明細は含まない）。新しい順。 */
export async function getDataFetchRunHistory(
    userId: string,
    limit = DATA_FETCH_HISTORY_LIMIT
): Promise<DataFetchRunView[]> {
    const runs = await prisma.dataFetchRun.findMany({
        where: { userId },
        orderBy: { startedAt: "desc" },
        take: limit,
    })
    return runs.map(toRunView)
}

/** 履歴から1件を開いたときの明細。他人の実行は返さない。 */
export async function getDataFetchRunDetail(
    userId: string,
    runId: number
): Promise<DataFetchRunDetail | null> {
    const run = await prisma.dataFetchRun.findFirst({
        where: { id: runId, userId },
        include: { items: { orderBy: { order: "asc" } } },
    })
    if (!run) return null
    return { ...toRunView(run), items: run.items.map(toItemView) }
}
